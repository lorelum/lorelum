import type { BlogIndexEntry } from "./list-posts";

export function parseBlogQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const query = value.trim().slice(0, 200);
  return query.length === 0 ? undefined : query;
}

export function searchBlogIndex(
  entries: readonly BlogIndexEntry[],
  query: string | undefined,
): BlogIndexEntry[] {
  const parsed = parseBlogQuery(query);
  if (parsed === undefined) return [...entries];
  const terms = parsed.normalize("NFKC").toLowerCase().split(/\s+/u);
  return entries.filter((entry) => {
    const text = `${entry.data.title}\n${entry.data.description}`.normalize("NFKC").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
