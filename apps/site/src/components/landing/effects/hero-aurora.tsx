import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { shouldRenderWebglAurora } from '../gates/aurora-gate';
import { gsap, registerGsapPlugins, ScrollTrigger } from '@/shared/motion/gsap-client';
import { detectWebglRenderer, type WebglCapability } from '../gates/webgl-renderer';

/**
 * Client-only WebGL aurora for the hero, gated to the cases where it can
 * shine: dark theme + desktop pointer + hardware WebGL + hero in view.
 * Everything else sees the CSS gradient mesh + particle field instead.
 *
 * `ogl` is loaded through `React.lazy` so it lands in a separate async chunk
 * (never in the pre-rendered HTML or the main bundle). The rAF loop is
 * stopped while the hero is offscreen or the tab is hidden, and the whole
 * layer unmounts when the gate flips false (e.g. theme switch to light).
 *
 * The chunk is fetched through a shared promise that this component also
 * kicks off eagerly on mount: the download then overlaps the hero entrance
 * instead of starting only after the settle timer, which used to make the
 * aurora appear seconds after a refresh (timer + full chunk round-trip + idle
 * wait, all serial). The chunk is imported directly from
 * `@/vendor/react-bits/aurora`, NOT through the barrel: `React.lazy` must
 * resolve to the component's own module, and the barrel would pull every
 * vendored component into this chunk and defeat the lazy-load.
 */
type AuroraModule = typeof import('@/vendor/react-bits/aurora');
let auroraChunkPromise: Promise<AuroraModule> | null = null;
const loadAuroraChunk = () =>
  (auroraChunkPromise ??= import('@/vendor/react-bits/aurora'));

const Aurora = lazy(loadAuroraChunk);

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

export function HeroAurora() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);
  const [touch, setTouch] = useState(false);
  const [webgl, setWebgl] = useState(false);
  // Software rasterizers (Microsoft Basic Render Driver / SwiftShader) choke on
  // a full-screen WebGL layer — the aurora drops to ~30fps while the CSS-only
  // fallback holds 60. Detected once on mount; `unknown` (SSR / unreadable)
  // passes the gate so we never degrade an unclassified setup.
  const [hardwareWebgl, setHardwareWebgl] = useState<WebglCapability>('unknown');
  const [inView, setInView] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  // The WebGL chunk load + context/shader init lands as a main-thread spike, so
  // it is deferred until the one-shot text entrance (clip/fade, ~1.1s) has
  // painted — otherwise the init competes with the headline reveal and produces
  // visible hitches on the first screen. The aurora then fades in underneath.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWebgl(isWebGLAvailable());
    setHardwareWebgl(detectWebglRenderer());
    setDark(document.documentElement.classList.contains('dark'));
    setTouch(window.matchMedia('(pointer: coarse)').matches);
    setViewportWidth(window.innerWidth);

    // Start fetching the WebGL chunk NOW, in parallel with the entrance —
    // without this the download only begins once the settle timer fires,
    // adding a full network round-trip after the timer before the aurora can
    // even mount. On a refresh the chunk is usually cached, but the fetch
    // still has to be issued; issuing it early costs nothing extra.
    void loadAuroraChunk();

    const onVisibility = () => setPaused(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', onVisibility);

    const themeObserver = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);

    // Defer the WebGL *init* (context + shader compile) until the hero's
    // one-shot text entrance has painted. The chunk itself is already
    // downloading in parallel (see loadAuroraChunk), so this delay only gates
    // the compile spike, not the network. Longest entrance delay on the hero
    // copy is ~0.42s + ~0.7s duration — 1.2s covers it with a little headroom.
    const settleTimer = window.setTimeout(() => setSettled(true), 1200);

    // Viewport gate for the WebGL layer. This uses the page's canonical
    // viewport idiom, a GSAP ScrollTrigger (see AGENTS.md hard rule 3 and
    // use-viewport-anim): it follows the ScrollSmoother's scroller and
    // refresh timing, so the gate flips the moment the hero leaves and the
    // full-screen WebGL canvas never keeps rasterizing after it scrolled
    // away — the single biggest idle GPU cost on this page.
    let cleanupGate: (() => void) | undefined;
    registerGsapPlugins();
    const ctx = gsap.context(() => {
      const trigger = ScrollTrigger.create({
        trigger: sectionRef.current,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (self) => setInView(self.isActive),
      });
      return () => trigger.kill();
    });
    cleanupGate = () => ctx.revert();

    return () => {
      window.clearTimeout(settleTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      themeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      cleanupGate?.();
    };
  }, []);

  const enabled =
    settled &&
    shouldRenderWebglAurora({
      mounted,
      dark,
      touch,
      webgl,
      hardwareWebgl,
      inView,
      viewportWidth,
    });

  return (
    <div ref={sectionRef} aria-hidden data-hero-aurora className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {enabled ? (
        <Suspense fallback={null}>
          <Aurora paused={paused} />
        </Suspense>
      ) : null}
    </div>
  );
}
