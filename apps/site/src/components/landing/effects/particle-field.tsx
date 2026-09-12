import { useEffect, useRef } from "react";
import { getCanvasScale, getParticleCount } from "../gates/particle-budget";

/**
 * Lightweight 2D particle field for the landing background.
 *
 * Deliberately cheap: no WebGL, no dependencies, ~40-90 slowly drifting
 * dots drawn with canvas 2D. The rAF loop only runs while the tab is
 * visible, the backing store never exceeds the CSS size (DPR capped at 1),
 * and colors follow the Fumadocs theme
 * (bright on dark, faint on light) and update live when the theme flips.
 *
 * The whole field leans gently away from the cursor — a single smoothed
 * translate applied before drawing (no per-particle math), which adds the
 * "alive" depth feel at nearly zero extra cost.
 *
 * Hot path tuned for the compositor: each particle's `rgb(...)` fill style
 * is precomputed once and alpha is applied via `globalAlpha` (a plain
 * number write) instead of building an `rgba(...)` string every frame.
 */
interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  /** Base alpha (0..1) before the per-particle twinkle. */
  alpha: number;
  phase: number;
  /** Twinkle speed in radians/second. */
  speed: number;
  /** Precomputed `rgb(r,g,b)` fill style, alpha applied via globalAlpha. */
  rgb: string;
}

const DARK_RGBS = ["255,255,255", "129,140,248", "34,211,238", "232,121,249"];
const LIGHT_RGBS = ["79,70,229", "14,116,144", "147,51,234"];

/** Max cursor-parallax offset in CSS px (mouse sits at the center by default). */
const MAX_PARALLAX = 18;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * The particles drift at ≤0.2px/frame and their twinkle is a slow sine
 * (periods of seconds), so 60fps redraws are invisible — each frame only
 * re-clears a full-screen canvas and re-draws ~90 dots at almost the same
 * spots. Redrawing at 30fps halves that raster cost with no visible change
 * (the largest per-frame move is still sub-pixel). The `tick` loop keeps its
 * own clock so easing and twinkle stay time-based, not frame-based.
 */
const FRAME_INTERVAL_MS = 1000 / 30;

function createParticles(count: number, w: number, h: number, dark: boolean): Particle[] {
  const rgbs = dark ? DARK_RGBS : LIGHT_RGBS;
  const alphaRange = dark ? [0.18, 0.45] : [0.08, 0.18];
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: rand(0.8, 2.4),
    vx: rand(-0.08, 0.08),
    vy: rand(-0.18, -0.04),
    alpha: rand(alphaRange[0], alphaRange[1]),
    phase: Math.random() * Math.PI * 2,
    speed: rand(0.4, 1.1),
    rgb: `rgb(${rgbs[Math.floor(Math.random() * rgbs.length)]})`,
  }));
}

export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let particles: Particle[] = [];

    // Cursor parallax: smoothed offset in CSS px, read only inside the loop.
    let tx = 0;
    let ty = 0;
    let ox = 0;
    let oy = 0;
    let lastDraw = 0;

    const isDark = () => document.documentElement.classList.contains("dark");

    const resize = () => {
      const dpr = getCanvasScale(window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = getParticleCount({
        width: w,
        height: h,
        dpr,
      });
      particles = createParticles(count, w, h, isDark());
    };

    const onPointerMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2 * MAX_PARALLAX;
      ty = (e.clientY / window.innerHeight - 0.5) * 2 * MAX_PARALLAX;
    };

    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      // Frame skipper: redraw at most every FRAME_INTERVAL_MS (30fps).
      const now = performance.now();
      if (now - lastDraw < FRAME_INTERVAL_MS) return;
      lastDraw = now;
      const t = now / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Ease the parallax toward the target (one pair of lerps per frame).
      ox += (tx - ox) * 0.04;
      oy += (ty - oy) * 0.04;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(ox, oy);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        // Wrap around edges (with a margin so dots fade out cleanly).
        if (p.x < -12) p.x = w + 12;
        else if (p.x > w + 12) p.x = -12;
        if (p.y < -12) p.y = h + 12;
        else if (p.y > h + 12) p.y = -12;
        const twinkle = 0.55 + 0.45 * Math.sin(t * p.speed + p.phase);
        ctx.globalAlpha = p.alpha * twinkle;
        ctx.fillStyle = p.rgb;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => cancelAnimationFrame(raf);

    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) start();
      else stop();
    };

    const onResize = () => {
      resize();
      if (running) start();
    };

    // Re-color when the theme flips (html gets/loses `.dark`).
    const observer = new MutationObserver(() => {
      const dark = isDark();
      const w = window.innerWidth;
      const h = window.innerHeight;
      particles = createParticles(particles.length, w, h, dark);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    resize();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      running = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
    />
  );
}
