import type { ComponentType } from "react";
import type { TOCItemType } from "fumadocs-core/toc";
import type { MDXComponents } from "mdx/types";

interface DocsModule {
  readonly default: ComponentType<{ components?: MDXComponents }>;
  readonly toc: TOCItemType[];
}

type DocsModuleLoader = () => Promise<DocsModule>;

/**
 * Compiled MDX modules available to the browser. This deliberately consumes
 * the Vite-generated modules directly instead of the macro registry: that
 * registry owns server-only filesystem helpers used by the Docs source index.
 */
const contentRoot = "../../../../content/docs";

const modules = import.meta.glob("../../../../content/docs/**/*.{md,mdx}", {
  query: {
    macro_id: "src/features/docs/content/registry.ts#docs",
  },
}) as Record<string, DocsModuleLoader>;

const pageCache = new Map<string, Promise<DocsModule>>();

function getLoader(path: string): DocsModuleLoader {
  const loader = modules[`${contentRoot}/${path}`];
  if (!loader) throw new Error(`Unknown documentation page: ${path}`);
  return loader;
}

/** Loads and memoizes one browser-renderable compiled MDX document. */
export function loadDocsPage(path: string): Promise<DocsModule> {
  const cached = pageCache.get(path);
  if (cached) return cached;

  const page = getLoader(path)();
  pageCache.set(path, page);
  return page;
}

/**
 * Starts loading an async MDX module before the screen renders it. The route
 * loader calls this on both client navigations and the initial render path.
 */
export async function preloadDocsPage(path: string): Promise<void> {
  await loadDocsPage(path);
}
