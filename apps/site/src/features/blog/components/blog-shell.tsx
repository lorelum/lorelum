import type { ReactNode } from "react";

/**
 * Responsive article columns or a full-width index. The body is a query
 * container so tables and figures can use its width without widening prose.
 */
interface BlogShellProps {
  readonly children: ReactNode;
  /** The index has no contents rail and can use that track for the story. */
  readonly index?: boolean;
  /** The blog's own navigation. Absent when a screen has nothing to put there. */
  readonly sidebar?: ReactNode;
  /** The article's table of contents. */
  readonly rail?: ReactNode;
}

export function BlogShell({ children, sidebar, rail, index = false }: BlogShellProps) {
  return (
    <div className={index ? "blog-shell blog-shell--index" : "blog-shell"}>
      {sidebar === undefined ? null : <div className="blog-shell__side">{sidebar}</div>}
      <div className="blog-shell__body min-w-0">{children}</div>
      {rail === undefined ? null : <div className="blog-shell__rail hidden">{rail}</div>}
    </div>
  );
}
