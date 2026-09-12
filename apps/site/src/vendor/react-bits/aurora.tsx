/*
 * Vendored from React Bits (https://reactbits.dev) — Aurora (TypeScript + Tailwind variant).
 * Source: https://reactbits.dev/r/Aurora-TS-TW
 * License: MIT + Commons Clause (see https://reactbits.dev/LICENSE.md).
 * Adapted for Lorelum's performance budget:
 *   - `paused` prop stops the rAF loop (tab hidden / hero offscreen).
 *   - DPR is capped at 0.85 and the backing canvas at 1024x640 so the
 *     fill-rate stays bounded on retina/4K displays. The glow is soft and
 *     stretched via CSS to cover the hero, so the lower backing resolution is
 *     visually indistinguishable but cuts the per-pixel shader work roughly in
 *     half versus full-viewport rendering — the single largest GPU cost on the
 *     opening screen.
 *   - All props are read through a ref so the renderer never re-initializes
 *     on prop changes.
 * See apps/site/THIRD_PARTY_NOTICE.md.
 */
import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
uniform float uLightMode;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \
  int index = 0;                                            \
  for (int i = 0; i < 2; i++) {                               \
     ColorStop currentColor = colors[i];                    \
     bool isInBetween = currentColor.position <= factor;    \
     index = int(mix(float(index), float(i), float(isInBetween))); \
  }                                                         \
  ColorStop currentColor = colors[index];                   \
  ColorStop nextColor = colors[index + 1];                  \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  if (uLightMode > 0.5) {
    float energy = clamp(max(intensity, 0.0), 0.0, 1.0);
    float coverage = clamp(auroraAlpha * (0.55 + 0.45 * energy), 0.0, 0.86);
    vec3 chroma = pow(clamp(rampColor, 0.0, 1.0), vec3(1.2));
    float chromaPeak = max(chroma.r, max(chroma.g, chroma.b));
    chroma /= max(chromaPeak, 0.0001);
    fragColor = vec4(mix(vec3(1.0), chroma, min(coverage * 1.08, 0.94)), 1.0);
  } else {
    fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
  }
}
`;

interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  speed?: number;
  lightMode?: boolean;
  /** When true the rAF loop stops (tab hidden / hero scrolled away). */
  paused?: boolean;
}

/** Cap so we never rasterize above ~0.5 MP on high-DPI displays (softer glow
 *  needs fewer pixels than crisp type; keeps fill-rate low on weak GPUs). */
const MAX_DPR = 0.85;
const MAX_WIDTH = 1024;
const MAX_HEIGHT = 640;

export default function Aurora(props: AuroraProps) {
  const {
    colorStops = ['#6366f1', '#a855f7', '#22d3ee'],
    amplitude = 1.0,
    blend = 0.6,
    lightMode = false,
  } = props;
  const propsRef = useRef<AuroraProps>(props);
  propsRef.current = props;

  const ctnDom = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    const ctn = ctnDom.current;
    if (!ctn) return;

    // The WebGL renderer creation + shader compile is a ~tens-of-ms main-thread
    // spike. It used to run synchronously in this effect, which made the hero
    // hitch exactly when the aurora first mounted. Defer the whole init to the
    // browser's idle period (falling back to a timeout so it still runs on
    // browsers without requestIdleCallback), so the compile lands in spare time
    // and never blocks a frame. Everything the cleanup needs is captured here.
    let cancelled = false;
    let animateId = 0;
    let running = false;
    let program: Program | undefined;
    let renderer: Renderer | undefined;
    let mesh: Mesh | undefined;
    let resizeHandler: (() => void) | undefined;
    const canvasHost: HTMLDivElement = ctn;

    const init = () => {
      if (cancelled || !canvasHost) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const r = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        dpr,
      });
      renderer = r;
      const gl = r.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.canvas.style.backgroundColor = 'transparent';
      // Site adaptation: fade the canvas in over ~1s (see .landing-aurora-canvas
      // in app.css) so the first compiled frame doesn't pop in abruptly.
      gl.canvas.className = 'landing-aurora-canvas';

      function resize() {
        if (!canvasHost || !gl || !program) return;
        const width = Math.min(canvasHost.offsetWidth, MAX_WIDTH);
        const height = Math.min(canvasHost.offsetHeight, MAX_HEIGHT);
        r.setSize(width, height);
        // `renderer.setSize` sizes the canvas CSS box to the (capped) backing
        // resolution. Stretch it back to fill the hero so a capped buffer never
        // leaves a black gap on wide/tall viewports — the backing is still
        // low-res (cheap), it just scales to cover.
        gl.canvas.style.width = '100%';
        gl.canvas.style.height = '100%';
        gl.canvas.style.display = 'block';
        if (program) {
          program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
        }
      }
      resizeHandler = resize;
      window.addEventListener('resize', resize);

      const geometry = new Triangle(gl);
      if (geometry.attributes.uv) {
        delete geometry.attributes.uv;
      }

      const stops = colorStops.map((hex) => {
        const c = new Color(hex);
        return [c.r, c.g, c.b];
      });

      program = new Program(gl, {
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uAmplitude: { value: amplitude },
          uColorStops: { value: stops },
          uResolution: { value: [canvasHost.offsetWidth, canvasHost.offsetHeight] },
          uBlend: { value: blend },
          uLightMode: { value: lightMode ? 1 : 0 },
        },
      });

      mesh = new Mesh(gl, { geometry, program });
      canvasHost.appendChild(gl.canvas);

      const update = (t: number) => {
        if (!running || cancelled) return;
        animateId = requestAnimationFrame(update);
        const p = propsRef.current;
        const time = t * 0.01;
        const s = p.speed ?? 1.0;
        if (program) {
          program.uniforms.uTime.value = time * s * 0.1;
          program.uniforms.uAmplitude.value = p.amplitude ?? amplitude;
          program.uniforms.uBlend.value = p.blend ?? blend;
          program.uniforms.uLightMode.value = (p.lightMode ?? lightMode) ? 1 : 0;
          const curStops = p.colorStops ?? colorStops;
          program.uniforms.uColorStops.value = curStops.map((hex: string) => {
            const c = new Color(hex);
            return [c.r, c.g, c.b];
          });
          renderer!.render({ scene: mesh! });
        }
      };

      const start = () => {
        if (running || cancelled) return;
        running = true;
        animateId = requestAnimationFrame(update);
      };
      const stop = () => {
        running = false;
        cancelAnimationFrame(animateId);
      };

      controlsRef.current = { start, stop };
      resize();
      // If the host had paused us before init finished (e.g. scrolled away in
      // the window between mount and the idle callback), don't start drawing.
      if (!propsRef.current.paused) start();
    };

    // Schedule the heavy init for idle time; the timeout bounds the wait so a
    // busy page can't postpone the aurora indefinitely (it used to be 2.5s,
    // which read as "the aurora never loads on refresh" when combined with the
    // serial chunk download). 400ms keeps the compile spike out of the first
    // frames without adding a noticeable delay.
    const scheduleIdle =
      typeof (window as { requestIdleCallback?: unknown }).requestIdleCallback === 'function'
        ? (window as {
            requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
          }).requestIdleCallback(init, { timeout: 400 })
        : (setTimeout(init, 0) as unknown as number);

    return () => {
      cancelled = true;
      running = false;
      cancelAnimationFrame(animateId);
      if (typeof (window as { cancelIdleCallback?: unknown }).cancelIdleCallback === 'function') {
        (window as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(
          scheduleIdle as number,
        );
      } else {
        clearTimeout(scheduleIdle as unknown as ReturnType<typeof setTimeout>);
      }
      controlsRef.current = null;
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      const gl = renderer?.gl;
      if (gl && gl.canvas.parentNode === canvasHost) {
        canvasHost.removeChild(gl.canvas);
      }
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [amplitude, blend, colorStops, lightMode]);

  // Pause/resume from the host (tab hidden, hero scrolled away, reduced motion).
  useEffect(() => {
    if (props.paused) {
      controlsRef.current?.stop();
    } else {
      controlsRef.current?.start();
    }
  }, [props.paused]);

  return <div ref={ctnDom} className="pointer-events-none h-full w-full" />;
}


