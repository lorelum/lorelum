/**
 * The generated cover's pattern: which cells of its grid are lit, and how
 * strongly. Pure and deterministic — the same slug always produces the same
 * pattern, on the server and on the client, in both themes.
 *
 * The grid is the art. Lorelum organises knowledge into packs, so the cover is
 * a pack seen from above: a field of rounded cells with a few lit, in the one
 * saturated brand channel the palette allows (the same monochrome rule the
 * category chip follows). Opacity, not hue, is the only variable, which keeps
 * the art decorative rather than a second colour system.
 */

/** One lit cell of the cover grid, as grid coordinates plus an opacity tier. */
export interface CoverCell {
  readonly column: number;
  readonly row: number;
  readonly opacity: number;
}

/** The grid geometry and the opacity vocabulary, exported for the renderer. */
export const coverGrid = {
  columns: 6,
  rows: 4,
  tiers: [0.1, 0.18, 0.32, 0.55] as const,
} as const;

/** FNV-1a: a short, stable string hash — the pattern must not drift. */
function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny seeded generator, so the pattern is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The cover pattern for one slug. Seeded by the slug alone, not the locale:
 * the zh and en entries of one slug are the same post, and their cards should
 * carry the same art the way they carry the same title.
 *
 * One to three cells are then promoted to the lit tier whatever the rolls said:
 * a cover with no lit cell has no focal point, and whether a post's art has one
 * must not depend on the hash it happened to get.
 */
export function coverCells(slug: string): CoverCell[] {
  const random = mulberry32(seedFrom(slug));
  const [faint, low, mid, high] = coverGrid.tiers;
  const cells: CoverCell[] = [];

  for (let row = 0; row < coverGrid.rows; row++) {
    for (let column = 0; column < coverGrid.columns; column++) {
      const roll = random();
      const opacity = roll < 0.5 ? faint : roll < 0.78 ? low : roll < 0.92 ? mid : high;
      cells.push({ column, row, opacity });
    }
  }

  const promotions = 1 + Math.floor(random() * 3);
  for (let promotion = 0; promotion < promotions; promotion++) {
    const index = Math.floor(random() * cells.length);
    cells[index] = { ...cells[index], opacity: high };
  }

  return cells;
}
