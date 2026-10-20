import type { BlogFrontmatter } from "../content/frontmatter";

/** Strip collection helpers from already-validated frontmatter for route payloads. */
export function pickFrontmatter(data: BlogFrontmatter): BlogFrontmatter {
  const projected: BlogFrontmatter = {
    title: data.title,
    description: data.description,
    date: data.date,
    category: data.category,
    author: data.author,
    draft: data.draft,
  };
  if (data.image !== undefined) projected.image = data.image;
  if (data.updated !== undefined) projected.updated = data.updated;
  return projected;
}
