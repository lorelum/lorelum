import { Suspense, use } from "react";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { gitConfig } from "@/shared/config/git";
import { loadDocsPage } from "./content/client";
import { useMDXComponents } from "./content/mdx-components";
import type { DocsPageData } from "./server/load-doc-page";
import { baseOptions } from "./layout/base-options";

interface DocsScreenProps {
  readonly lang: string;
  readonly pageData: DocsPageData;
}

function DocsContent({
  path,
  markdownUrl,
  title,
  description,
}: Pick<DocsPageData, "path" | "markdownUrl" | "title" | "description">) {
  const { default: MDX, toc } = use(loadDocsPage(path));

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <div className="flex flex-row items-center gap-2 border-b -mt-4 pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${path}`}
        />
      </div>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

/** Browser screen for Fumadocs layout and compiled MDX content. */
export function DocsScreen({ lang, pageData }: DocsScreenProps) {
  const { path, pageTree, markdownUrl, title, description } =
    useFumadocsLoader(pageData);

  return (
    <DocsLayout {...baseOptions(lang)} tree={pageTree}>
      <Suspense>
        <DocsContent
          path={path}
          markdownUrl={markdownUrl}
          title={title}
          description={description}
        />
      </Suspense>
    </DocsLayout>
  );
}
