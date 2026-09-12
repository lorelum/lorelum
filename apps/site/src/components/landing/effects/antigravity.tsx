/*
 * Landing particle ring — an original GPU particle effect for the CTA panel,
 * inspired by the look of the particle ring on antigravity.google. No code
 * from that site is used; the shaders below are written for Lorelum.
 *
 * Architecture:
 *
 *   1. A few thousand points are poisson-disc sampled into a [-1, 1] square
 *      and stored in a 256×256 RGBA float texture (xy = home position,
 *      z = scale, w = velocity). Empty texels stay at zero and are hidden by
 *      alpha discard.
 *   2. Every other frame a simulation shader integrates the state texture
 *      into a ping-pong render target: particles inside a breathing gaussian
 *      ring band gain scale and velocity, pick up a tangential orbit, and
 *      are pulled toward the ring core; everything else relaxes toward its
 *      home position under a two-octave turbulent drift.
 *   3. A point-cloud pass draws each texel as a soft round sprite, sized by
 *      sim scale and brightened by velocity, tinted along a three-color ramp
 *      driven by per-particle simplex noise — reading as a glowing galaxy
 *      ring that eases after the cursor or wanders on noise when idle.
 *
 * The simplex-noise GLSL is webgl-noise by Ashima Arts / Stefan Gustavson
 * (MIT) — see THIRD_PARTY_NOTICE.md for the attribution record.
 *
 * SSR/perf notes: callers gate this behind `motion-aware-*`; DPR is capped
 * at 1, the sim pauses while the canvas leaves the viewport, and every GPU
 * resource is disposed on unmount.
 */

/* eslint-disable react/no-unknown-property */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { poissonDiscFill } from "@/lib/poisson-disc";

export interface AntigravityProps {
  /** Poisson density — higher value = denser points. */
  density?: number;
  /** Global point-size multiplier. */
  pointScale?: number;
  /** Soft outer width of the ring band (world units). */
  bandWidth?: number;
  /** Width of the bright ring core (world units). */
  coreWidth?: number;
  /** How strongly band particles are pulled onto the ring. */
  pullStrength?: number;
}

const SIM_SIZE = 256;
const SAMPLE_SPACE = 500;

/*
 * 3D simplex noise — webgl-noise by Ashima Arts / Stefan Gustavson, MIT
 * license (https://github.com/ashima/webgl-noise). Verbatim redistribution
 * under the MIT header above.
 */
const SNOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/*
 * Simulation pass: integrates every state texel.
 *   uState = previous frame state (xy = position, z = scale, w = velocity)
 *   uHome  = static poisson home positions
 * A gaussian band around the breathing ring drives three forces — a
 * tangential orbit, a radial spring onto the ring, and a scale/velocity
 * charge — while a two-octave drift field keeps the whole cloud slowly
 * alive everywhere else.
 */
const SIM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uHome;
uniform vec2 uRingPos;
uniform float uTime;
uniform float uRingRadius;
uniform float uBandWidth;
uniform float uCoreWidth;
uniform float uPull;
${SNOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / ${SIM_SIZE.toFixed(1)};
  vec4 st = texture2D(uState, uv);
  vec2 pos = st.xy;
  float scale = st.z;
  float vel = st.w;
  vec2 home = texture2D(uHome, uv).xy;

  // Ring radius breathes on two slow sinusoids.
  float ring = uRingRadius * (1.0 + 0.15 * sin(uTime * 0.85) + 0.06 * sin(uTime * 2.3 + 1.3));
  float d = distance(pos, uRingPos);
  float band = exp(-pow((d - ring) / uBandWidth, 2.0));
  float core = exp(-pow((d - ring) / uCoreWidth, 2.0));

  // Two-octave turbulent drift, time-scrolled: large-scale sway + small shimmer.
  float t = uTime * 0.5;
  vec2 drift = vec2(
    snoise(vec3(pos * 0.06, t)),
    snoise(vec3(pos * 0.06 + 19.7, t + 11.0))
  ) * 0.035
  + vec2(
    snoise(vec3(pos * 0.23 + 40.0, t * 1.7)),
    snoise(vec3(pos * 0.23 + 40.0, t * 1.7 + 17.0))
  ) * 0.008;

  // Orbit: a tangential current that only band particles ride.
  vec2 toRing = uRingPos - pos;
  vec2 tangent = vec2(-toRing.y, toRing.x) / max(length(toRing), 1e-3);
  vec2 orbit = tangent * band * (0.018 + 0.010 * sin(uTime * 0.6));

  // Radial spring: band particles drift onto the ring, the rest ignore it.
  vec2 radial = toRing / max(length(toRing), 1e-3);
  vec2 pull = -radial * (d - ring) * band * uPull;

  pos = mix(pos, home + drift + orbit, 0.22) + pull;

  // Charge scale from the band, plus a slow ambient shimmer so the whole
  // dust field stays faintly visible outside the ring. Velocity chases
  // scale (afterglow).
  float ambient = 0.5 + 0.5 * snoise(vec3(home * 1.7, t * 0.35));
  scale += (band * (0.8 + 0.4 * core) + ambient * 0.42 - scale) * 0.2;
  vel += (scale - vel) * 0.32;

  gl_FragColor = vec4(pos, scale, vel);
}
`;

const SIM_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

/*
 * Render pass, vertex side: per-particle work happens here (cheaper than
 * per-fragment) — read the state texel, derive the color-ramp phase from
 * simplex noise seeded per particle, and size the point from its scale.
 */
const RENDER_VERT = /* glsl */ `
precision highp float;
attribute vec4 seeds;
uniform sampler2D uState;
uniform float uTime;
uniform float uParticleScale;
varying float vScale;
varying float vVel;
varying float vMix;
varying float vSeed;
${SNOISE}
void main() {
  vec4 st = texture2D(uState, uv);
  vScale = st.z;
  vVel = st.w;
  vSeed = seeds.x;
  vMix = 0.5 + 0.5 * snoise(vec3(st.xy * 2.2, uTime * 0.45 + seeds.x * 6.2831));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(st.xy, 0.0, 1.0);
  gl_PointSize = clamp(uParticleScale * (0.5 + st.z) * (7.0 + 5.0 * seeds.y), 1.0, 7.0);
}
`;

/*
 * Render pass, fragment side: a soft round sprite with a gaussian falloff
 * (reads the same as the reference's rotated capsule at these point sizes),
 * tinted along color1 -> color2 -> color3 by the per-particle mix and
 * brightened by velocity.
 */
const RENDER_FRAG = /* glsl */ `
precision highp float;
varying float vScale;
varying float vVel;
varying float vMix;
varying float vSeed;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float sprite = 1.0 - smoothstep(0.3, 1.0, length(p) * 2.0);
  float a = uAlpha * sprite * smoothstep(0.06, 0.32, vScale);
  if (a < 0.01) {
    discard;
  }

  vec3 col = mix(uColor1, uColor2, clamp(vMix * 1.5, 0.0, 1.0));
  col = mix(col, uColor3, smoothstep(0.55, 1.0, vMix));
  col *= 0.75 + 0.75 * clamp(vVel, 0.0, 1.0);

  gl_FragColor = vec4(col, a);
}
`;

/* Smooth 1D pseudo-noise in [-1, 1] — drives the idle cursor wander. */
function noise1D(x: number): number {
  return (Math.sin(x) + Math.sin(x * 2.17 + 1.7) * 0.6 + Math.sin(x * 4.31 + 3.1) * 0.35) / 1.95;
}

const AntigravityInner = ({
  density = 220,
  pointScale = 0.65,
  bandWidth = 0.16,
  coreWidth = 0.055,
  pullStrength = 0.24,
}: AntigravityProps) => {
  const { gl, size, viewport } = useThree();

  const visibleRef = useRef(true);
  useEffect(() => {
    // Pause sim/render while the canvas is off-screen, without stopping
    // fiber's frameloop — a stopped frameloop skips resizes and froze the
    // buffer at 300x150.
    const canvas = gl.domElement;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((entry) => (visibleRef.current = entry.isIntersecting)),
      { threshold: 0 },
    );
    io.observe(canvas);
    return () => io.disconnect();
  }, [gl]);

  const ringPosRef = useRef(new THREE.Vector2(0, 0));
  const cursorRef = useRef(new THREE.Vector2(0, 0));
  const lastMoveRef = useRef(0);
  const pointerNormRef = useRef({ x: -2, y: -2, over: false });
  const frameRef = useRef(0);
  const pingPongRef = useRef<{
    read: THREE.WebGLRenderTarget;
    write: THREE.WebGLRenderTarget;
  } | null>(null);
  const everRenderedRef = useRef(false);
  const particleScaleRef = useRef(0.4);

  /*
   * One-time GPU resources: initial state texture, ping-pong targets, the sim
   * quad scene, and the points geometry/material.
   */
  const gpu = useMemo(() => {
    const minDistance = 10 + (density * (2 - 10)) / 300;
    const maxDistance = 11 + (density * (3 - 11)) / 300;

    const samples = poissonDiscFill({
      shape: [SAMPLE_SPACE, SAMPLE_SPACE],
      minDistance,
      maxDistance,
      tries: 20,
    });
    const count = samples.length;

    // Initial state texture: xy = home position in [-1, 1], z = scale, w = velocity.
    const stateData = new Float32Array(SIM_SIZE * SIM_SIZE * 4);
    for (let i = 0; i < count; i++) {
      const [sx, sy] = samples[i]!;
      stateData[i * 4 + 0] = (sx - SAMPLE_SPACE / 2) * (1 / (SAMPLE_SPACE / 2));
      stateData[i * 4 + 1] = (sy - SAMPLE_SPACE / 2) * (1 / (SAMPLE_SPACE / 2));
      stateData[i * 4 + 2] = 0;
      stateData[i * 4 + 3] = 0;
    }
    const posTex = new THREE.DataTexture(
      stateData,
      SIM_SIZE,
      SIM_SIZE,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    posTex.minFilter = THREE.NearestFilter;
    posTex.magFilter = THREE.NearestFilter;
    posTex.needsUpdate = true;

    const rtOptions: THREE.RenderTargetOptions = {
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    };
    const rt1 = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);
    const rt2 = new THREE.WebGLRenderTarget(SIM_SIZE, SIM_SIZE, rtOptions);
    pingPongRef.current = { read: rt1, write: rt2 };

    // Sim quad scene (full-screen quad, orthographic camera).
    const simMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uState: { value: posTex },
        uHome: { value: posTex },
        uRingPos: { value: new THREE.Vector2(0, 0) },
        uRingRadius: { value: 0.18 },
        uBandWidth: { value: bandWidth },
        uCoreWidth: { value: coreWidth },
        uPull: { value: pullStrength },
        uTime: { value: 0 },
      },
      vertexShader: SIM_VERT,
      fragmentShader: SIM_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const simScene = new THREE.Scene();
    const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial);
    simScene.add(simQuad);

    // Points geometry: one vertex per sample, position texel grid in `uv`.
    const geometry = new THREE.BufferGeometry();
    const uv = new Float32Array(count * 2);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      uv[i * 2] = (i % SIM_SIZE) / SIM_SIZE;
      uv[i * 2 + 1] = Math.floor(i / SIM_SIZE) / SIM_SIZE;
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute("seeds", new THREE.BufferAttribute(seeds, 4));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);

    const renderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uState: { value: posTex },
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color("#7189ff") },
        uColor2: { value: new THREE.Color("#3074f9") },
        uColor3: { value: new THREE.Color("#05060f") },
        uAlpha: { value: 1 },
        uParticleScale: { value: 0.4 },
      },
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    return {
      posTex,
      rt1,
      rt2,
      simScene,
      simCamera,
      simQuad,
      simMaterial,
      geometry,
      renderMaterial,
      count,
    };
    // Recreate only if density changes (re-sampling is expensive).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  useEffect(() => {
    const gpuRef = gpu;
    return () => {
      gpuRef.geometry.dispose();
      gpuRef.renderMaterial.dispose();
      gpuRef.simMaterial.dispose();
      (gpuRef.simQuad as THREE.Mesh).geometry.dispose();
      gpuRef.posTex.dispose();
      gpuRef.rt1.dispose();
      gpuRef.rt2.dispose();
    };
  }, [gpu]);

  // Pointer tracking over the whole window (the layer is pointer-events-none).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastMoveRef.current = performance.now();
      pointerNormRef.current.over = true;
      pointerNormRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerNormRef.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((state) => {
    if (!visibleRef.current) return; // off-screen: hold the last frame
    const t = state.clock.getElapsedTime();
    frameRef.current += 1;

    const { simMaterial, renderMaterial } = gpu;
    const width = size.width || 1;

    particleScaleRef.current = (width / 1700) * pointScale;

    /*
     * Cursor position: ease toward the pointer mapped through a 0.175 gain
     * over the viewport half-extent, plus a slow noise wander; when the
     * pointer goes idle the wander takes over entirely.
     */
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;
    const nowMs = performance.now();
    const idle = nowMs - lastMoveRef.current > 1400;
    const wanderT = t * 0.66 + 94.234;
    const wanderN = t * 0.75 + 21.028;
    if (!idle && pointerNormRef.current.over) {
      cursorRef.current.set(
        pointerNormRef.current.x * halfW * 0.175 + noise1D(wanderT) * 0.1,
        pointerNormRef.current.y * halfH * 0.175 + noise1D(wanderN) * 0.1,
      );
      ringPosRef.current.x += (cursorRef.current.x - ringPosRef.current.x) * 0.02;
      ringPosRef.current.y += (cursorRef.current.y - ringPosRef.current.y) * 0.02;
    } else {
      cursorRef.current.set(noise1D(wanderT) * 0.2, noise1D(wanderN) * 0.1);
      ringPosRef.current.x += (cursorRef.current.x - ringPosRef.current.x) * 0.01;
      ringPosRef.current.y += (cursorRef.current.y - ringPosRef.current.y) * 0.01;
    }

    simMaterial.uniforms.uTime.value = t;
    simMaterial.uniforms.uRingRadius.value = 0.18;
    (simMaterial.uniforms.uRingPos.value as THREE.Vector2).copy(ringPosRef.current);

    renderMaterial.uniforms.uTime.value = t;
    renderMaterial.uniforms.uParticleScale.value = particleScaleRef.current;

    // Sim every other frame, then render the freshest state.
    if (frameRef.current % 2 === 0) {
      gl.setRenderTarget(pingPongRef.current!.write);
      gl.render(gpu.simScene, gpu.simCamera);
      gl.setRenderTarget(null);
      renderMaterial.uniforms.uState.value = everRenderedRef.current
        ? pingPongRef.current!.write.texture
        : gpu.posTex;
      // Swap for the next sim step.
      pingPongRef.current = { read: pingPongRef.current!.write, write: pingPongRef.current!.read };
      everRenderedRef.current = true;
    } else if (everRenderedRef.current) {
      renderMaterial.uniforms.uState.value = pingPongRef.current!.read.texture;
    } else {
      renderMaterial.uniforms.uState.value = gpu.posTex;
    }
  });

  return (
    <points geometry={gpu.geometry} frustumCulled={false} scale={5}>
      <primitive object={gpu.renderMaterial} attach="material" />
    </points>
  );
};

const Antigravity = (props: AntigravityProps) => {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.1], fov: 40 }}
      dpr={1}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", stencil: false }}
      style={{ width: "100%", height: "100%" }}
    >
      <AntigravityInner {...props} />
    </Canvas>
  );
};

export default Antigravity;
