import { Suspense, use } from "react";
import { Text } from "lucide-react";
import { DocsBody, DocsDescription, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { TOCProvider, TOCScrollArea, useTOCItems } from "fumadocs-ui/components/toc";
import { TOCItem, TOCItems } from "fumadocs-ui/components/toc/default";
import { LandingNavbar } from "@/features/landing/navigation/landing-navbar";
import { SiteFooter } from "@/components/landing/sections/site-footer";
import { useMDXComponents } from "@/shared/mdx/mdx-components";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { loadBlogContent } from "./content/client";
import type { BlogPostData } from "./server/load-blog-post";
import "./styles/blog.css";

interface BlogPostScreenProps {
  readonly lang: string;
  readonly post: BlogPostData;
}

/** Sticky right-rail table of contents; consumes the shared TOC provider. */
function BlogTableOfContents({ lang }: { lang: string }) {
  const items = useTOCItems();
  const t = getStrings(lang);

  return (
    <aside
      aria-label={t.blogOnThisPage}
      className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-[240px] shrink-0 overflow-y-auto pb-8 pe-2 pt-2 xl:block"
    >
      <h3 className="inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground">
        <Text aria-hidden="true" className="size-4" />
        {t.blogOnThisPage}
      </h3>
      <TOCScrollArea className="ms-px">
        <TOCItems>
          {items.map((item) => (
            <TOCItem key={item.url} item={item} />
          ))}
        </TOCItems>
      </TOCScrollArea>
    </aside>
  );
}

function BlogPostBody({ lang, post }: { lang: string; post: BlogPostData }) {
  const { default: MDX, toc } = use(loadBlogContent(post.path));
  const { data } = post;

  return (
    // The provider observes heading anchors across the reading row, so it
    // wraps both the article and the table of contents.
    <TOCProvider toc={toc}>
      <div className="mx-auto flex w-full items-start justify-center gap-6 xl:gap-10">
        <article className="w-full max-w-[860px] min-w-0">
          <DocsTitle>{data.title}</DocsTitle>
          <DocsDescription>{data.description}</DocsDescription>

          <div className="blog-post__meta flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-fd-border/60 pb-5 text-sm text-fd-muted-foreground">
            <time dateTime={data.date}>{data.date}</time>
            <span aria-hidden="true" className="h-3.5 w-px bg-fd-border/60" />
            <span>{data.author}</span>
            <span aria-hidden="true" className="h-3.5 w-px bg-fd-border/60" />
            <span>{data.category}</span>
          </div>

          <DocsBody>
            <MDX components={useMDXComponents()} />
          </DocsBody>
        </article>

        <BlogTableOfContents lang={lang} />
      </div>
    </TOCProvider>
  );
}

/**
 * Browser screen for a single blog post: the site navbar plus a stable
 * reading column with a sticky table of contents. The Fumadocs page atoms
 * (title, description, prose body, TOC) render inside the `.blog-scope` token
 * adapter; the navbar and footer intentionally keep the global landing theme.
 */
export function BlogPostScreen({ lang, post }: BlogPostScreenProps) {
  return (
    <div className="blog-page flex min-h-dvh flex-col">
      <LandingNavbar lang={lang} />

      <main className="lorelum-ui blog-scope mx-auto w-full max-w-[1160px] flex-1 px-4 pb-24 pt-24">
        <Suspense>
          <BlogPostBody lang={lang} post={post} />
        </Suspense>
      </main>

      <SiteFooter lang={lang} />
    </div>
  );
}
