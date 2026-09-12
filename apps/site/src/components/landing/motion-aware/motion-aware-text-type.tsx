import { useEffect, useState, type RefObject } from 'react';
import { TextType } from '@/vendor/react-bits';
import { gsap, registerGsapPlugins, ScrollTrigger } from '@/shared/motion/gsap-client';

/**
 * Motion-aware wrapper around the vendored `react-bits/text-type` base.
 *
 * NOT the base component: `@/vendor/react-bits/text-type` is the upstream
 * copy; this file is the landing's accessibility gate on top of it. Keep this
 * name distinct (`motion-aware-*`) so a reader never confuses the plain
 * vendored component with the safe-to-use landing one.
 *
 * Renders a plain, fully-visible string on the server (no typing/erasing, no
 * blinking cursor), then mounts the typewriter effect once hydration lands.
 * `startOnVisible` is intentionally NOT used: the hero gates typing itself via
 * ScrollTrigger (the page's canonical viewport gate — see AGENTS.md hard rule
 * 3), so the typewriter never runs above/off-screen on first paint.
 *
 * The typewriter also pauses when its scroll container leaves the viewport
 * (ScrollTrigger): while the hero is scrolled away it renders the
 * static first phrase and stops the per-character setState chain, then resumes
 * typing when the hero comes back.
 */
export function MotionAwareTextType({
  text,
  className,
  cursorClassName,
  scrollContainerRef,
  typingSpeed = 45,
  deletingSpeed = 26,
  pauseDuration = 2200,
  initialDelay = 300,
  loop = true,
}: {
  text: string[];
  className?: string;
  cursorClassName?: string;
  /** Element whose viewport visibility gates the typing (hero section). */
  scrollContainerRef: RefObject<HTMLElement | null>;
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseDuration?: number;
  initialDelay?: number;
  loop?: boolean;
}) {
  // Start paused; the ScrollTrigger below flips it on once the container is in
  // view, so the typewriter never runs above/off-screen on first paint.
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    registerGsapPlugins();

    const ctx = gsap.context(() => {
      const trigger = ScrollTrigger.create({
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (self) => setActive(self.isActive),
      });
      return () => trigger.kill();
    });

    return () => ctx.revert();
  }, [scrollContainerRef]);

  if (!active) {
    return <span className={className}>{text[0]}</span>;
  }

  return (
    <TextType
      // `key` remounts the typewriter on language switch: TextType keeps its
      // typing progress (index/partial string) in local state, so if the
      // `text` array changes but the component stays mounted it keeps typing
      // the OLD language's phrase (and only updates once its loop wraps
      // around). Keying on the phrases reseats the progress to the new
      // language immediately.
      key={text.join('|')}
      text={text}
      as="span"
      className={className}
      cursorClassName={cursorClassName}
      typingSpeed={typingSpeed}
      deletingSpeed={deletingSpeed}
      pauseDuration={pauseDuration}
      initialDelay={initialDelay}
      loop={loop}
      showCursor
    />
  );
}
