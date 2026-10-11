import type { CSSProperties } from "react";
import type { IndexBlock } from "../model/index-layout";
import { BlogCard } from "./blog-card";
import { BlogFeaturedEntry } from "./blog-featured-entry";

interface BlogIndexBlocksProps {
  readonly blocks: readonly IndexBlock[];
  readonly lang: string;
}

const key = (entry: { slug: string; locale: string }) => `${entry.slug}-${entry.locale}`;

/**
 * Renders the index's magazine layout as ONE list, so a screen reader hears
 * "list, N items" for the whole index rather than a run of one-item lists. The
 * shape comes from grid placement, not from nesting: a 12-column grid at `lg`
 * (6 at `md`, 1 below), where each item takes the span its block gives it.
 *
 * - hero: the lead across the full width, bleeding past the list's gutter so
 *   its stage stays full-bleed, then two side cards at half width each;
 * - grid: three cards at a third each;
 * - band: one entry across the full width;
 * - split: the feature at 7 of 12 columns, spanning as many rows as it has
 *   thumbnails (`.blog-split-feature` in `blog.css`), with the thumbnails in the
 *   remaining 5 columns beside it.
 *
 * Items are emitted in the layout model's order, which is the entries' date
 * order, and auto-placement fills the grid in that same order.
 */
export function BlogIndexBlocks({ blocks, lang }: BlogIndexBlocksProps) {
  return (
    <ul className="mt-10 grid grid-cols-1 gap-6 px-6 md:grid-cols-6 lg:grid-cols-12 xl:px-12">
      {blocks.flatMap((block) => {
        switch (block.kind) {
          case "hero":
            return [
              <BlogFeaturedEntry
                key={key(block.lead)}
                entry={block.lead}
                lang={lang}
                className="col-span-full -mx-6 xl:-mx-12"
              />,
              ...block.sides.map((entry) => (
                <BlogCard
                  key={key(entry)}
                  entry={entry}
                  lang={lang}
                  variant="grid"
                  className="md:col-span-3 lg:col-span-6"
                />
              )),
            ];
          case "grid":
            return block.items.map((entry) => (
              <BlogCard
                key={key(entry)}
                entry={entry}
                lang={lang}
                variant="grid"
                className="md:col-span-3 lg:col-span-4"
              />
            ));
          case "band":
            return [
              <BlogCard key={key(block.entry)} entry={block.entry} lang={lang} variant="band" className="col-span-full" />,
            ];
          case "split":
            return [
              <BlogCard
                key={key(block.feature)}
                entry={block.feature}
                lang={lang}
                variant="feature"
                className="blog-split-feature col-span-full lg:col-span-7"
                style={{ "--blog-split-rows": block.list.length } as CSSProperties}
              />,
              ...block.list.map((entry) => (
                <BlogCard
                  key={key(entry)}
                  entry={entry}
                  lang={lang}
                  variant="thumb"
                  className="col-span-full lg:col-span-5 lg:self-center"
                />
              )),
            ];
        }
      })}
    </ul>
  );
}
