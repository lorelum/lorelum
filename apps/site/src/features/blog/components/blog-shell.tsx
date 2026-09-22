import type { ReactNode } from "react";

/**
 * The blog's editorial shell: a left column, the reading column, and — on the
 * article page — the table-of-contents rail.
 *
 * The columns are the widths the surface already owns; the shell only decides
 * how many of them exist at a given viewport and where they sit. `.blog-shell`
 * carries the track lists, because each one is a different composition of two
 * aliases and the CSS is the place that can say so once.
 *
 * The middle column is also a query container (`blog-shell__body`), because the
 * elements that are allowed to use its full width — figures and tables — have to
 * measure against the column rather than against the viewport or the reading
 * measure. That is what lets prose stay at 68ch while a wide table uses the
 * space beside it instead of overflowing or scrolling inside a narrow box.
 *
 * The side columns are rendered as elements at every width and hidden by the
 * shell's own rules below their breakpoint, so a track is never reserved for a
 * column that is not there. Their content is always in the served HTML: hiding a
 * column visually does not remove it from the document for a reader without CSS,
 * and the shell has no interactive state of its own to keep in sync with it.
 */
interface BlogShellProps {
  readonly children: ReactNode;
  /** The blog's own navigation. Absent when a screen has nothing to put there. */
  readonly sidebar?: ReactNode;
  /** The article's table of contents. */
  readonly rail?: ReactNode;
}

export function BlogShell({ children, sidebar, rail }: BlogShellProps) {
  return (
    <div className="blog-shell">
      {sidebar === undefined ? null : <div className="blog-shell__side">{sidebar}</div>}
      <div className="blog-shell__body min-w-0">{children}</div>
      {rail === undefined ? null : <div className="blog-shell__rail hidden">{rail}</div>}
    </div>
  );
}
