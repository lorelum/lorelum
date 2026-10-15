import type { BlogIndexEntry } from "../model/list-posts";
import { coverCells, coverGrid, coverTierIndex } from "../model/cover-pattern";

interface BlogCoverProps {
  readonly entry: BlogIndexEntry;
  readonly className?: string;
  readonly priority?: boolean;
}

/**
 * A card's cover art.
 *
 * Index cards only request authored images; callers without an image omit the
 * media area entirely. Article closing cards can still request a generated
 * mosaic, seeded by slug so both locales share the same art.
 *
 * The generated branch is `aria-hidden` and the author image carries an empty
 * alt: the frontmatter has no alt text to honour, and the title sits directly
 * beside the art naming the same post, so a screen reader would only hear the
 * title twice.
 */
export function BlogCover({ entry, className, priority = false }: BlogCoverProps) {
  if (entry.data.image !== undefined) {
    return (
      <img
        src={entry.data.image}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
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
