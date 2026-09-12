import { createFileRoute } from "@tanstack/react-router";
import { searchDocs } from "@/features/docs/search/server";

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => searchDocs(request),
    },
  },
});
