import { useEffect, useState } from "react";
import { readWebglRendererString } from "./gates/webgl-renderer";

/**
 * On-screen frame-rate probe for diagnosing scroll/entrance jank in a REAL
 * browser (e.g. the user's Edge), where the agent cannot open DevTools.
 *
 * Mounts only when the URL carries `?probe=1` (or `probe=1` for any value), so
 * normal visitors never see it. It renders plain DOM text (readable by
 * accessibility/screenshots) in a fixed corner and refreshes once a second:
 *   - rAF fps + worst frame gap over the last second
 *   - CSS viewport size + devicePixelRatio
 *   - live particle / aurora canvas backing-store sizes
 *   - the WebGL renderer string (surfaces software rasterizers such as
 *     SwiftShader, the classic cause of "smooth in a small window, janky
 *     fullscreen")
 *   - IntersectionObserver activity on an element deep in the smooth content
 *     (the footer) — settles the "does IO fire at all under ScrollSmoother?"
 *     question on real hardware (see AGENTS.md hard rule 3)
 * Measurement is one rAF loop + one 1s interval; nothing else runs.
 */
export function FpsProbe() {
  const [show, setShow] = useState(false);
  const [stats, setStats] = useState<string[]>([]);

  useEffect(() => {
    if (!new URL(window.location.href).searchParams.has("probe")) return;
    setShow(true);

    // Also surface the headline numbers in the document title ("42 fps — …")
    // so screen-reader/AX-based automation can read them from the tab name
    // even when the fixed corner overlay sits below the visible AX window.
    const originalTitle = document.title;

    // The GPU driver actually backing WebGL — "SwiftShader" / "llvmpipe" mean
    // software rendering, which scales terribly with screen area. Same probe
    // as the aurora gate (webgl-renderer.ts), raw string here.
    const glRenderer = readWebglRendererString() ?? "webgl-unavailable";

    // A/B layer hiding for diagnosing jank in a real browser: pass
    // `&hide=aurora` and/or `&hide=particles` to disable that layer via CSS
    // (`display:none` stops its rAF from ever being scheduled), then compare
    // the fps in the tab title. `&hide=canvas` turns both off at once.
    const hideParam = new URL(window.location.href).searchParams.get("hide");
    const hideLayers = new Set((hideParam ?? "").split(",").filter(Boolean));
    const applyHide = () => {
      const hideAurora =
        hideLayers.has("aurora") || hideLayers.has("canvas") || hideLayers.has("all");
      const hideParticles =
        hideLayers.has("particles") || hideLayers.has("canvas") || hideLayers.has("all");
      for (const c of document.querySelectorAll("canvas")) {
        const isAurora = !!c.closest("[data-hero-aurora]");
        if ((isAurora && hideAurora) || (!isAurora && hideParticles)) {
          c.style.display = "none";
        }
      }
    };
    applyHide();
    if (hideLayers.size > 0) {
      new MutationObserver(applyHide).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    // IntersectionObserver activity probe. IO always fires once on observe,
    // so a count that stays at 1 while the page scrolls means IO never sees
    // viewport crossings (the ScrollSmoother hazard); a count that grows
    // means IO fires under the current ScrollSmoother configuration.
    // ScrollTrigger stays the canonical viewport gate (AGENTS.md hard rule 3)
    // — if you rely on IO, verify here and record the configuration.
    let ioFires = 0;
    let ioState: "in" | "out" | "n/a" = "n/a";
    const ioTarget = document.querySelector("#smooth-content footer");
    const io =
      ioTarget &&
      new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            ioFires += 1;
            ioState = entry.isIntersecting ? "in" : "out";
          }
        },
        { threshold: 0 },
      );
    if (io && ioTarget) io.observe(ioTarget);

    let raf = 0;
    let last = performance.now();
    let running = true;
    const gaps: number[] = [];
    const loop = () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      // Keep only the most recent ~4s of samples.
      if (gaps.length > 240) gaps.shift();
    };
    raf = requestAnimationFrame(loop);

    const timer = window.setInterval(() => {
      const snapshot = gaps.splice(0);
      const avg = snapshot.length ? snapshot.reduce((a, b) => a + b, 0) / snapshot.length : 0;
      const max = snapshot.length ? Math.max(...snapshot) : 0;
      const canvases = [...document.querySelectorAll("canvas")].map(
        (c) => `${c.width}x${c.height}`,
      );
      const auroraMounted = !!document.querySelector("[data-hero-aurora] canvas");
      const offscreen = document.querySelectorAll(".landing-gradient-text.is-offscreen").length;
      const fpsText = avg ? Math.round(1000 / avg) : "-";
      setStats([
        `fps ${fpsText} | maxFrame ${Math.round(max)}ms`,
        `viewport ${window.innerWidth}x${window.innerHeight} | dpr ${window.devicePixelRatio}`,
        `canvases ${canvases.join(" | ") || "none"} | aurora:${auroraMounted} offscreen:${offscreen}`,
        `io ${ioFires} fires, last:${ioState}`,
        `gl ${glRenderer}`,
      ]);
      // Compact title keeps AX-visible; `m` = max frame ms.
      const glShort = glRenderer.replace(/^(ANGLE \()?/, "").slice(0, 28);
      document.title = `[${fpsText}fps m${Math.round(max)}ms ${glShort}] ${originalTitle}`;
    }, 1000);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearInterval(timer);
      io?.disconnect();
      document.title = originalTitle;
    };
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-2 right-2 z-[2147483646] rounded-md bg-black/85 px-2 py-1 font-mono text-[10px] leading-tight text-lime-300 shadow-lg"
    >
      {stats.length === 0 ? (
        <div>probe warming…</div>
      ) : (
        stats.map((line) => <div key={line}>{line}</div>)
      )}
    </div>
  );
}
