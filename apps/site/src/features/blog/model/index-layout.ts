import type { BlogIndexEntry } from "./list-posts";

export interface BlogIndexLayout {
  readonly featured: BlogIndexEntry | undefined;
  readonly posts: readonly BlogIndexEntry[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
}

const pageSize = 12;

export function parseBlogPage(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return 1;
  const page = typeof value === "string" ? Number(value) : value;
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** Preserves input order, reserving the latest entry outside ordinary pagination. */
export function layoutIndex(
  entries: readonly BlogIndexEntry[],
  options: { readonly page: number; readonly featureLatest: boolean },
): BlogIndexLayout {
  const offset = options.featureLatest && entries.length > 0 ? 1 : 0;
  const pageCount = Math.max(1, Math.ceil((entries.length - offset) / pageSize));
  const page = Math.min(parseBlogPage(options.page), pageCount);
  const start = offset + (page - 1) * pageSize;

  return {
    featured: options.featureLatest && page === 1 ? entries[0] : undefined,
    posts: entries.slice(start, start + pageSize),
    page,
    pageCount,
    total: entries.length,
  };
}
