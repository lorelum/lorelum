import type { BlogIndexEntry } from "../model/list-posts";
import { coverCells, coverGrid, coverTierIndex } from "../model/cover-pattern";

interface BlogCoverProps {
  readonly entry: BlogIndexEntry;
  readonly className?: string;
}

/**
 * A card's cover art.
 *
 * The reference indexes the maintainer pointed at — OpenAI's and Claude's —
 * ship no text-only card, so art here is not gated on an author supplying it:
 * a post with frontmatter `image` renders that file, and a post without one
 * gets a generated mosaic (see `cover-pattern.ts`), seeded by its slug so both
 * locales of one post carry the same art.
 *
 * The generated branch is `aria-hidden` and the author image carries an empty
 * alt: the frontmatter has no alt text to honour, and the title sits directly
 * beside the art naming the same post, so a screen reader would only hear the
 * title twice.
 */
export function BlogCover({ entry, className }: BlogCoverProps) {
  if (entry.data.image !== undefined) {
    return (
      <img
        src={entry.data.image}
        alt=""
        // Below the fold by construction (the index lists many cards), so the
        // art never competes with the page's own content for bandwidth.
        loading="lazy"
        decoding="async"
        className={className}
      />
    );
  }

  const pitch = 20;
  const size = 18;
  const cells = coverCells(entry.slug);

  return (
    <svg
      viewBox={`0 0 ${coverGrid.columns * pitch} ${coverGrid.rows * pitch}`}
      aria-hidden="true"
      // The adapter styles each tier's strength per theme through this hook
      // (see the cover rules in `styles/blog.css`); the rects' own opacity
      // attributes remain as the no-CSS baseline.
      className={`blog-cover-art bg-[var(--lore-brand-deep)] p-5 ${className ?? ""}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        width={coverGrid.columns * pitch}
        height={coverGrid.rows * pitch}
        fill="var(--lore-brand-deep)"
      />
      {cells.map((cell) => (
        <rect
          key={`${cell.column}-${cell.row}`}
          x={1 + cell.column * pitch}
          y={1 + cell.row * pitch}
          width={size}
          height={size}
          rx={1}
          fill="var(--lore-brand-light)"
          opacity={cell.opacity}
          data-tier={coverTierIndex(cell.opacity)}
        />
      ))}
    </svg>
  );
}
