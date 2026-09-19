import type { ComponentType } from "react";
import type { TOCItemType } from "fumadocs-core/toc";
import type { MDXComponents } from "mdx/types";

interface BlogModule {
  readonly default: ComponentType<{ components?: MDXComponents }>;
  readonly toc: TOCItemType[];
}

type BlogModuleLoader = () => Promise<BlogModule>;

/**
 * Compiled MDX modules available to the browser. This deliberately consumes
 * the Vite-generated modules directly instead of the macro registry: that
 * registry owns server-only filesystem helpers used by the Blog source index.
 */
const contentRoot = "../../../../content/blog";

const modules = import.meta.glob("../../../../content/blog/**/*.{md,mdx}", {
  query: {
    macro_id: "src/features/blog/content/registry.ts#blog",
  },
}) as Record<string, BlogModuleLoader>;

const postCache = new Map<string, Promise<BlogModule>>();

function getLoader(path: string): BlogModuleLoader {
  const loader = modules[`${contentRoot}/${path}`];
  if (!loader) throw new Error(`Unknown blog post: ${path}`);
  return loader;
}

/** Loads and memoizes one browser-renderable compiled MDX document. */
export function loadBlogContent(path: string): Promise<BlogModule> {
  const cached = postCache.get(path);
  if (cached) return cached;

  const post = getLoader(path)();
  postCache.set(path, post);
  return post;
}

/**
 * Starts loading an async MDX module before the screen renders it. The route
 * loader calls this on both client navigations and the initial render path.
 */
export async function preloadBlogContent(path: string): Promise<void> {
  await loadBlogContent(path);
}
