import { useNavigate } from "@tanstack/react-router";
import { createDialogHandle } from "@lorelum/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import {
  SearchDialog, SearchDialogClose, SearchDialogContent, SearchDialogFooter,
  SearchDialogHeader, SearchDialogIcon, SearchDialogInput, SearchDialogList,
  SearchDialogListItem, SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { blogDialogResults } from "../model/dialog-results";
import { blogIndexPath, blogPostPath } from "../model/blog-routes";
import { parseBlogQuery } from "../model/search-posts";
import type { BlogIndexEntry } from "../model/list-posts";
import type { BlogSort } from "../model/sort-posts";
import type { BlogCategory } from "../content/frontmatter";

interface BlogSearchDialogProps {
  readonly lang: string;
  readonly posts: readonly BlogIndexEntry[];
  readonly category?: BlogCategory;
  readonly sort: BlogSort;
  readonly q?: string;
}

export function BlogSearchDialog({ lang, posts, category, sort, q }: BlogSearchDialogProps) {
  const t = getStrings(lang);
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dialogHandle] = useState(createDialogHandle);
  const [search, setSearch] = useState(q ?? "");
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalContainer(document.body);
  }, []);
  useEffect(() => {
    setSearch(q ?? "");
  }, [category, sort, q]);
  const results = blogDialogResults(posts, search, category, sort);
  const hasQuery = parseBlogQuery(search) !== undefined;
  const byId = new Map(results.map((entry) => [`${entry.locale}:${entry.slug}`, entry]));
  const items = results.map((entry) => ({
    id: `${entry.locale}:${entry.slug}`,
    type: "page" as const,
    content: entry.data.title,
    url: blogPostPath(entry.locale, entry.slug),
  }));

  return (
    <SearchDialog
      dialogHandle={dialogHandle}
      open={open}
      onOpenChange={(next) => {
        if (next) setSearch(q ?? "");
        setOpen(next);
      }}
      search={search}
      onSearchChange={setSearch}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={t.blogSearch}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "fd-search-dialog-content" : undefined}
        onClick={() => {
          setSearch(q ?? "");
          setOpen(true);
        }}
        data-blog-search-trigger
        className="inline-flex min-h-[var(--lore-size-touch)] min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 text-sm text-fd-muted-foreground transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] lg:w-72"
      >
        <Search size={16} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{q ?? t.blogSearchPlaceholder}</span>
      </button>
      {portalContainer === null ? null : createPortal(<SearchDialogOverlay data-blog-search-overlay />, portalContainer)}
      <SearchDialogContent finalFocus={trigger} className="lorelum-ui blog-search-dialog [overflow-wrap:anywhere]">
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput id="blog-search" name="q" form="blog-search-form" type="search" autoComplete="off" maxLength={200} aria-label={t.blogSearch} placeholder={t.blogSearchPlaceholder} className="min-h-[var(--lore-size-touch)]" />
          <SearchDialogClose data-blog-search-close className="min-h-[var(--lore-size-touch)] min-w-[var(--lore-size-touch)]" />
        </SearchDialogHeader>
        <SearchDialogList
          items={items}
          data-blog-search-results
          Empty={() => <p className="px-3 py-10 text-center text-sm text-fd-muted-foreground">{hasQuery ? t.blogNoSearchResults : t.blogSearchStart}</p>}
          Item={({ item, onClick }) => {
            const entry = byId.get(item.id);
            return (
              <SearchDialogListItem item={item} onClick={onClick} lang={entry?.locale} className="min-h-[var(--lore-size-touch)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]">
                <p className="font-medium">{entry?.data.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">{entry?.data.description}</p>
              </SearchDialogListItem>
            );
          }}
        />
        <SearchDialogFooter>
          <form
            id="blog-search-form"
            role="search"
            method="get"
            action={blogIndexPath(lang)}
            onKeyDownCapture={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.requestSubmit();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              setOpen(false);
              void navigate({ to: blogIndexPath(lang), search: { category, sort, q: parseBlogQuery(search) } });
            }}
            className="flex w-full items-center justify-between gap-3"
          >
            <p role="status" aria-live="polite" className="text-sm text-fd-muted-foreground">{t.blogSearchResults.replace("{count}", String(results.length))}</p>
            {category === undefined ? null : <input type="hidden" name="category" value={category} />}
            <input type="hidden" name="sort" value={sort} />
            <button type="submit" data-blog-search-apply className={`${buttonVariants({ color: "outline" })} min-h-[var(--lore-size-touch)] shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]`}>{t.blogSearchApply}</button>
          </form>
        </SearchDialogFooter>
      </SearchDialogContent>
    </SearchDialog>
  );
}
