import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { blogIndexPath } from "../model/blog-routes";
import { BlogSurface } from "./blog-surface";

interface BlogNotFoundProps {
  readonly lang: string;
}

/**
 * The blog's own not-found body.
 *
 * The route already returns a 404 through the router's `notFound()`, so this is
 * about which 404 a reader sees: the shared one is written for the docs and
 * drops them outside the blog's reading scope. This keeps the missing-post case
 * inside the blog surface and offers the index as the way out.
 */
export function BlogNotFound({ lang }: BlogNotFoundProps) {
  const t = getStrings(lang);

  return (
    <BlogSurface lang={lang}>
      <h1 className="text-3xl font-semibold tracking-tight text-fd-foreground">
        {t.blogNotFoundTitle}
      </h1>
      <p className="mt-3 text-fd-muted-foreground">{t.blogNotFoundBody}</p>
      <p className="mt-8">
        <Link
          to={blogIndexPath(lang)}
          activeOptions={{ exact: true }}
          className="blog-nav-link inline-flex items-center gap-1.5"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {t.navBlog}
        </Link>
      </p>
    </BlogSurface>
  );
}
