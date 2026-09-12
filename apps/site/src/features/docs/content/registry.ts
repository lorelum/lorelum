import { defineDocs } from "fumadocs-mdx/macro";

/**
 * The single Fumadocs content registry for both the browser renderer and the
 * server-side source index. Keeping this module free of loader construction
 * prevents the Docs screen from importing the server source.
 */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});
