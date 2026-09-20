import { getMDXComponents } from "@/shared/mdx/mdx-components";
import { BlogEvidenceList } from "../components/blog-evidence-list";

/**
 * MDX component map for blog content.
 *
 * The blog's own components are merged here rather than added to
 * `shared/mdx/mdx-components.tsx`: that map is shared with the docs surface, and
 * a blog-only authoring component must not become available to docs content.
 */
export function useBlogMdxComponents() {
  return getMDXComponents({ BlogEvidenceList });
}
