import { Suspense, use } from "react";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import "./styles/docs.css";
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
import { useMDXComponents } from "@/shared/mdx/mdx-components";
import type { DocsPageData } from "./server/load-doc-page";
import { baseOptions } from "./layout/base-options";
import { resolveContentLink } from "./content/resolve-content-link";

interface DocsScreenProps {
  readonly lang: string;
  readonly pageData: DocsPageData;
}

function DocsContent({
  path,
  markdownUrl,
  title,
  description,
  lang,
}: Pick<DocsPageData, "path" | "markdownUrl" | "title" | "description"> & { lang: string }) {
  const { default: MDX, toc } = use(loadDocsPage(path));

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <div className="docs-page-actions flex flex-row items-center gap-2 border-b -mt-4 pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/site/content/docs/${path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={useMDXComponents({
            a: ({ href, children, ...props }) => (
              <a {...props} href={resolveContentLink(href ?? "", path, lang)}>
                {children}
              </a>
            ),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

/** Browser screen for Fumadocs layout and compiled MDX content. */
export function DocsScreen({ lang, pageData }: DocsScreenProps) {
  const { path, pageTree, markdownUrl, title, description } = useFumadocsLoader(pageData);

  return (
    <DocsLayout {...baseOptions(lang)} tree={pageTree} containerProps={{ className: "lorelum-ui" }}>
      <Suspense>
        <DocsContent
          lang={lang}
          path={path}
          markdownUrl={markdownUrl}
          title={title}
          description={description}
        />
      </Suspense>
    </DocsLayout>
  );
}
