import { defineDocs } from "fumadocs-mdx/macro";
import { blogFrontmatterSchema } from "./frontmatter";

/**
 * The single Fumadocs content registry for blog posts, consumed by both the
 * browser renderer and the server-side source index. Keeping this module free
 * of loader construction prevents the Blog screens from importing the server
 * source.
 */
export const blog = defineDocs({
  dir: "content/blog",
  docs: {
    async: true,
    schema: blogFrontmatterSchema,
  },
});
