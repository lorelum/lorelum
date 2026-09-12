import { useEffect, useRef } from 'react';
import { gsap, registerGsapPlugins, SplitText } from '@/shared/motion/gsap-client';
import { cn } from '@/shared/lib/cn';

const HAS_CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * GSAP SplitText reveal for a line of copy, Antigravity-style.
 *
 * Splits into words (Latin) or characters (CJK) and sharpens them as the line
 * travels through the viewport. Unlike a one-shot fire-and-forget timeline,
 * this is a scrub: progress is bound to scroll, so scrolling up reverses the
 * reveal and the words settle at exactly their natural position (y 0,
 * opacity 1) once the line reaches the upper-middle of the viewport.
 * It is SSR-safe: the text renders as plain visible HTML so no-JS and content
 * that is already on screen never flashes. On the server it never
 * splits, so the text stays as a single readable element. Created inside
 * `gsap.context` and split DOM is reverted on unmount so SPA navigation
 * can't leak.
 */
export function SplitTextReveal({
  text,
  mode = 'auto',
  className,
  y = 16,
}: {
  text: string;
  mode?: 'auto' | 'words' | 'chars';
  className?: string;
  /** Vertical travel in px. */
  y?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerGsapPlugins();

    const ctx = gsap.context(() => {
      const useChars = mode === 'chars' || (mode === 'auto' && HAS_CJK.test(text));
      const split = SplitText.create(el, {
        type: 'chars,words',
        tag: 'span',
        charsClass: 'split-char',
        wordsClass: 'split-word',
      });
      const units = useChars ? split.chars : split.words;
      if (!units || units.length === 0) return;

      // If the heading is already on screen when hydration lands, keep it fully
      // visible. Hiding it would cause a visible flash before the reveal, which
      // is worse than the small benefit of re-animating an above-the-fold title.
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        return () => split.revert();
      }

      const count = units.length;
      const stagger = useChars ? Math.min(0.008, 0.5 / count) : Math.min(0.035, 0.6 / count);

      gsap.set(units, { opacity: 0, y });
      const tween = gsap.to(units, {
        opacity: 1,
        y: 0,
        ease: 'none',
        stagger: { each: stagger, from: 'start' },
        scrollTrigger: {
          trigger: el,
          start: 'top 96%',
          end: 'top 60%',
          scrub: true,
        },
      });

      return () => {
        tween.scrollTrigger?.kill();
        split.revert();
      };
    });

    return () => ctx.revert();
  }, [text, mode, y]);

  return (
    // `key={text}` is load-bearing: GSAP SplitText rewrites this span's
    // children into `split-char`/`split-word` element trees. When `text`
    // changes (e.g. a language switch swaps en→zh), React reconciles against
    // that GSAP-rewritten DOM, can't replace the placeholder spans, and the
    // heading is left stuck in the previous language. Keying on `text` forces
    // React to unmount the old span (its cleanup runs `split.revert()`, which
    // restores the plain text) and remount a fresh one, so the new language
    // renders cleanly. Same-language scroll reveals are unaffected because the
    // key is stable across re-renders.
    <span key={text} ref={ref} className={cn('landing-splittext', className)}>
      {text}
    </span>
  );
}
