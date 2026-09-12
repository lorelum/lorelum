import { createFileRoute, notFound } from "@tanstack/react-router";
import { decodeMarkdownUrl } from "@/features/docs/content/markdown-url";
import { getLLMText, source } from "@/features/docs/server/source";

export const Route = createFileRoute("/$lang/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { _splat: splat } = params;
        const slugs = decodeMarkdownUrl(splat?.split("/") ?? []);
        const page = source.getPage(slugs, params.lang);
        if (!page) throw notFound();

        return new Response(await getLLMText(page), {
          headers: {
            "Content-Type": "text/markdown",
          },
        });
      },
    },
  },
});
