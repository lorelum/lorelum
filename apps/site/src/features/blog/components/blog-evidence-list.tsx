import type { ReactNode } from "react";

/** Styling scope for an always-visible evidence appendix of ordinary Markdown lists. */
export function BlogEvidenceList({ children }: { readonly children: ReactNode }) {
  return <div className="blog-evidence">{children}</div>;
}
