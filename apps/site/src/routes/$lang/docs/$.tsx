import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { preloadDocsPage } from "@/features/docs/content/client";
import { DocsScreen } from "@/features/docs";
import { loadDocsPage } from "@/features/docs/server/load-doc-page";

export const Route = createFileRoute("/$lang/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await serverLoader({ data: { slugs, lang: params.lang } });
    await preloadDocsPage(data.path);
    return data;
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.title} | Lorelum` : "Docs | Lorelum";
    const description = loaderData?.description;

    return {
      meta: [
        { title },
        ...(description ? [{ name: "description", content: description }] : []),
      ],
    };
  },
});

const serverLoader = createServerFn({
  method: "GET",
})
  .validator((params: { slugs: string[]; lang?: string }) => params)
  .handler(async ({ data }) => {
    const pageData = await loadDocsPage(data);
    if (!pageData) throw notFound();
    return pageData;
  });

function Page() {
  const { lang } = Route.useParams();
  return <DocsScreen lang={lang} pageData={Route.useLoaderData()} />;
}
