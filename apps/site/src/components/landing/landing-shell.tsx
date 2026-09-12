import { type ReactNode } from 'react';
import { LandingNavbar } from '@/features/landing/navigation/landing-navbar';
import { PageBackground } from './effects/page-background';
import { FpsProbe } from './fps-probe';
import {
  SmoothScroll,
  SMOOTH_CONTENT_ID,
  SMOOTH_WRAPPER_ID,
} from './motion/smooth-scroll';

/**
 * Landing-page shell, replacing Fumadocs `HomeLayout` on the marketing route
 * only (docs keep `DocsLayout`).
 *
 * The navigation stays outside the transformed ScrollSmoother content so its
 * fixed positioning is unaffected by the landing page's translated content.
 */
export function LandingShell({
  lang,
  children,
}: {
  lang: string;
  children: ReactNode;
}) {
  return (
    <>
      <LandingNavbar lang={lang} />

      {/* Fixed/ambient layers must live outside the translated scroll content
          so ScrollSmoother never turns their `position: fixed` into a
          transform-relative one. */}
      <PageBackground />
      {/* Diagnostics overlay — dev only, and self-gated to ?probe=1 URLs. */}
      {import.meta.env.DEV ? <FpsProbe /> : null}

      <SmoothScroll>
        <div id={SMOOTH_WRAPPER_ID} className="relative w-full">
          <div id={SMOOTH_CONTENT_ID}>{children}</div>
        </div>
      </SmoothScroll>
    </>
  );
}
