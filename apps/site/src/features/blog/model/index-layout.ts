import type { BlogIndexEntry } from "./list-posts";

/**
 * One block of the index's magazine layout. Every block takes a fixed number of
 * entries from the ordered list, fewer when the list runs out, so a block never
 * renders empty and a short list degrades instead of leaving holes:
 *
 * - `hero`: the lead image, with up to two smaller cards in a row below it;
 * - `grid`: up to three cards in a row;
 * - `band`: one entry on a full-width tinted band;
 * - `split`: one feature card beside a short list of thumbnails. It needs at
 *   least one thumbnail: a lone entry that would open a split is a band instead,
 *   because a feature card without its list would span the whole width and
 *   outgrow the lead.
 */
export type IndexBlock =
  | { readonly kind: "hero"; readonly lead: BlogIndexEntry; readonly sides: readonly BlogIndexEntry[] }
  | { readonly kind: "grid"; readonly items: readonly BlogIndexEntry[] }
  | { readonly kind: "band"; readonly entry: BlogIndexEntry }
  | { readonly kind: "split"; readonly feature: BlogIndexEntry; readonly list: readonly BlogIndexEntry[] };

const heroSides = 2;
const gridSize = 3;
const splitList = 4;

/** What follows the hero, repeated for as long as entries remain. */
const cycle = ["grid", "band", "split"] as const;

/**
 * Arranges the ordered entries into blocks. The hero always comes first, then
 * the cycle grid, band, split repeats. Order is preserved: reading the blocks
 * top to bottom, left to right, gives the entries back in their original order,
 * each exactly once.
 */
export function layoutIndex(entries: readonly BlogIndexEntry[]): IndexBlock[] {
  if (entries.length === 0) return [];

  const [lead, ...rest] = entries;
  const blocks: IndexBlock[] = [{ kind: "hero", lead, sides: rest.slice(0, heroSides) }];
  let at = heroSides;

  for (let step = 0; at < rest.length; step++) {
    const kind = cycle[step % cycle.length];
    if (kind === "grid") {
      blocks.push({ kind, items: rest.slice(at, at + gridSize) });
      at += gridSize;
    } else if (kind === "band" || at + 1 >= rest.length) {
      blocks.push({ kind: "band", entry: rest[at] });
      at += 1;
    } else {
      blocks.push({ kind, feature: rest[at], list: rest.slice(at + 1, at + 1 + splitList) });
      at += 1 + splitList;
    }
  }

  return blocks;
}
