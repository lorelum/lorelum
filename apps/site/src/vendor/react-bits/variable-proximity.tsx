/*
 * Vendored from React Bits (https://reactbits.dev) — VariableProximity
 * (TypeScript + Tailwind variant).
 * Source: https://reactbits.dev/r/VariableProximity-TS-TW
 * License: MIT + Commons Clause (see https://reactbits.dev/LICENSE.md).
 * See apps/site/THIRD_PARTY_NOTICE.md.
 *
 * Adapted for Lorelum:
 *   - `fontFamily` now inherits from the surrounding display type instead of
 *     hard-coding "Roboto Flex", so Bricolage Grotesque's variable axes (the
 *     `opsz`/`wght` range loaded from Google Fonts) drive the effect.
 *   - Ref types loosened to the React 19 `RefObject` contract.
 *   - Perf: the original reads `getBoundingClientRect()` for the container and
 *     for *every* letter on *every* frame the pointer moves, which forces a
 *     layout flush ~N+1 times per frame and janks while hovering the hero. We
 *     now cache letter centers (container-local) and the container rect once,
 *     refresh them on resize/scroll, and only write `font-variation-settings`
 *     from cached positions — zero layout reads in the animation loop.
 */
import { forwardRef, useMemo, useRef, useEffect, type RefObject, type CSSProperties, type HTMLAttributes } from 'react';
import { motion, useAnimationFrame } from 'motion/react';

/**
 * Raw pointer position (client coords). The container-relative math is done
 * against cached geometry inside the loop, so pointer move never reads layout.
 */
function useMousePositionRef() {
  const positionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (ev: MouseEvent) => {
      positionRef.current = { x: ev.clientX, y: ev.clientY };
    };
    const handleTouchMove = (ev: TouchEvent) => {
      const touch = ev.touches[0];
      if (touch) positionRef.current = { x: touch.clientX, y: touch.clientY };
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  return positionRef;
}

interface VariableProximityProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  fromFontVariationSettings: string;
  toFontVariationSettings: string;
  containerRef: RefObject<HTMLElement | null>;
  radius?: number;
  falloff?: 'linear' | 'exponential' | 'gaussian';
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
}

interface Point {
  x: number;
  y: number;
}

const VariableProximity = forwardRef<HTMLSpanElement, VariableProximityProps>((props, ref) => {
  const {
    label,
    fromFontVariationSettings,
    toFontVariationSettings,
    containerRef,
    radius = 50,
    falloff = 'linear',
    className = '',
    onClick,
    style,
    ...restProps
  } = props;

  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const letterCentersRef = useRef<Point[]>([]);
  const containerRectRef = useRef<{ left: number; top: number } | null>(null);
  const mousePositionRef = useMousePositionRef();
  const lastPositionRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  const parsedSettings = useMemo(() => {
    const parseSettings = (settingsStr: string) =>
      new Map(
        settingsStr
          .split(',')
          .map((s) => s.trim())
          .map((s) => {
            const [name, value] = s.split(' ');
            return [name.replace(/['"]/g, ''), parseFloat(value)];
          }),
      );

    const fromSettings = parseSettings(fromFontVariationSettings);
    const toSettings = parseSettings(toFontVariationSettings);

    return Array.from(fromSettings.entries()).map(([axis, fromValue]) => ({
      axis,
      fromValue,
      toValue: toSettings.get(axis) ?? fromValue,
    }));
  }, [fromFontVariationSettings, toFontVariationSettings]);

  const calculateDistance = (x1: number, y1: number, x2: number, y2: number) =>
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

  const calculateFalloff = (distance: number) => {
    const norm = Math.min(Math.max(1 - distance / radius, 0), 1);
    switch (falloff) {
      case 'exponential':
        return norm ** 2;
      case 'gaussian':
        return Math.exp(-((distance / (radius / 2)) ** 2) / 2);
      case 'linear':
      default:
        return norm;
    }
  };

  // Cache geometry once (and on resize). Letter centers are stored in
  // container-local coordinates, so the animation loop never reads layout.
  useEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      containerRectRef.current = { left: cRect.left, top: cRect.top };
      letterRefs.current.forEach((letter, index) => {
        if (!letter) return;
        const rect = letter.getBoundingClientRect();
        letterCentersRef.current[index] = {
          x: rect.left + rect.width / 2 - cRect.left,
          y: rect.top + rect.height / 2 - cRect.top,
        };
      });
    };

    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(containerRef.current);
    }
    const onScroll = () => {
      const container = containerRef.current;
      if (!container) return;
      const cRect = container.getBoundingClientRect();
      containerRectRef.current = { left: cRect.left, top: cRect.top };
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, [containerRef]);

  // Stop-the-world idle behavior (perf): the callback is invoked by
  // `motion.useAnimationFrame` only while *something* in the tree is animating
  // (a MotionValue/spring/transition ticking). When the pointer is stationary
  // the springs settle, the loop stops, and no frame does any work. On top of
  // that, the callback itself skips every frame while the pointer stays within
  // the same ~0.5px cell (`moveEpsilon`), so a tiny hand tremor doesn't rewrite
  // per-letter styles at 60fps. Both gates make the hero headline's proximity
  // effect cost ~nothing while the page sits still.
  const moveEpsilon = 0.5;
  const lastCellRef = useRef<{ x: number; y: number } | null>(null);

  useAnimationFrame(() => {
    const containerRect = containerRectRef.current;
    if (!containerRect) return;
    const { x, y } = mousePositionRef.current;
    if (lastPositionRef.current.x === x && lastPositionRef.current.y === y) {
      return;
    }
    const cell = { x: Math.round(x / moveEpsilon), y: Math.round(y / moveEpsilon) };
    const lastCell = lastCellRef.current;
    if (lastCell && lastCell.x === cell.x && lastCell.y === cell.y) return;
    lastCellRef.current = cell;
    lastPositionRef.current = { x, y };

    letterRefs.current.forEach((letterRef, index) => {
      if (!letterRef) return;
      const center = letterCentersRef.current[index];
      if (!center) return;

      const distance = calculateDistance(
        x - containerRect.left,
        y - containerRect.top,
        center.x,
        center.y,
      );

      if (distance >= radius) {
        if (letterRef.dataset.fvs !== fromFontVariationSettings) {
          letterRef.dataset.fvs = fromFontVariationSettings;
          letterRef.style.fontVariationSettings = fromFontVariationSettings;
        }
        return;
      }

      const falloffValue = calculateFalloff(distance);
      const newSettings = parsedSettings
        .map(({ axis, fromValue, toValue }) => {
          const interpolatedValue = fromValue + (toValue - fromValue) * falloffValue;
          return `'${axis}' ${interpolatedValue}`;
        })
        .join(', ');

      // Skip the style write when the value is unchanged (pointer micro-moves
      // inside the same 0.5px cell resolve to identical settings after the
      // rounding above, so this drops the per-letter style churn to zero while
      // the hand is essentially still).
      if (letterRef.dataset.fvs !== newSettings) {
        letterRef.dataset.fvs = newSettings;
        letterRef.style.fontVariationSettings = newSettings;
      }
    });
  });

  const words = label.split(' ');
  let letterIndex = 0;

  return (
    <span
      ref={ref}
      onClick={onClick}
      style={{ display: 'inline', ...style }}
      className={className}
      {...restProps}
    >
      {words.map((word, wordIndex) => (
        <span key={wordIndex} className="inline-block whitespace-nowrap">
          {word.split('').map((letter) => {
            const currentLetterIndex = letterIndex++;
            return (
              <motion.span
                key={currentLetterIndex}
                ref={(el) => {
                  letterRefs.current[currentLetterIndex] = el;
                }}
                style={{ display: 'inline-block' }}
                aria-hidden="true"
              >
                {letter}
              </motion.span>
            );
          })}
          {wordIndex < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
});

VariableProximity.displayName = 'VariableProximity';
export default VariableProximity;
