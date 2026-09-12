import { encodeMarkdownUrl } from "../content/markdown-url";
import { source } from "./source";

export interface LoadDocsPageInput {
  readonly slugs: string[];
  readonly lang?: string;
}

export interface DocsPageData {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly markdownUrl: string;
  readonly pageTree: Awaited<ReturnType<typeof source.serializePageTree>>;
}

/**
 * Resolves every server-owned value needed to render a single Docs page.
 * Routes keep transport, server-function registration, and HTTP error
 * semantics; this module only assembles Fumadocs source data.
 */
export async function loadDocsPage({
  slugs,
  lang,
}: LoadDocsPageInput): Promise<DocsPageData | undefined> {
  const page = source.getPage(slugs, lang);
  if (!page) return undefined;

  return {
    path: page.path,
    title: page.data.title,
    description: page.data.description ?? "",
    markdownUrl: encodeMarkdownUrl(page.slugs, page.locale),
    pageTree: await source.serializePageTree(source.getPageTree(lang)),
  };
}
