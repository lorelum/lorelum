import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/shared/config/site";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET() {
        const body = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
        return new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
