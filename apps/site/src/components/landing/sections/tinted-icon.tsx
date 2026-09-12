import type { LucideIcon } from "lucide-react";

/** Accent colors for a card, tuned per section (see features/problem). */
export interface AccentTint {
  /** Text/glyph color utility class, e.g. `text-amber-400`. */
  text: string;
  /** Gradient utility classes for the tile background. */
  grad: string;
}

/**
 * The accent icon tile shared by the features/problem cards: gradient tile,
 * hover halo ring, gently swaying glyph (animation lives in landing.css).
 * `size` switches between the two layouts in use (feature card md, problem
 * card sm).
 */
export function TintedIcon({
  icon: Icon,
  tint,
  delayMs,
  size,
}: {
  icon: LucideIcon;
  tint: AccentTint;
  /** Entrance animation delay in ms — use i * 90/100 for card staggers. */
  delayMs: number;
  size: "md" | "sm";
}) {
  const tile =
    size === "md"
      ? "size-10 rounded-xl text-fd-foreground ring-fd-border/60"
      : "size-9 rounded-lg text-fd-muted-foreground ring-fd-border/50";
  const glyph = size === "md" ? "size-5" : "size-4";

  return (
    <div
      className={`landing-icon inline-flex ${tile} shrink-0 items-center justify-center bg-gradient-to-br ${tint.grad} ring-1`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span aria-hidden className="landing-icon-halo" />
      <Icon
        className={`landing-icon-glyph ${glyph} ${tint.text}`}
        style={{ animationDelay: `${delayMs}ms` }}
      />
    </div>
  );
}
