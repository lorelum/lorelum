import type { ReactNode } from "react";

/**
 * The evidence appendix: the public documents a post's numbers and claims rest
 * on.
 *
 * A plain list, not a disclosure and not a card. The `<Accordions>` this
 * replaces rendered as a single card (`rounded-lg border bg-fd-card` whose four
 * entries were all collapsed, `aria-expanded="false"`), so a reader had to click
 * before seeing where any number came from, and the `id="evidence-*"` anchors
 * those entries carried had no inbound links anywhere in the repository.
 *
 * The wrapper exists for the styling hook, not for the items: the items inside
 * are ordinary Markdown list items, so the authoring surface and the Markdown
 * twins stay Markdown rather than component markup.
 */
export function BlogEvidenceList({ children }: { readonly children: ReactNode }) {
  return <div className="blog-evidence">{children}</div>;
}
