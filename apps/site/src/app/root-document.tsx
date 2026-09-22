import { HeadContent, Scripts, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { i18n } from "@/shared/i18n/config";
import { AppProviders } from "./providers";

export function RootDocument({ children }: { children: ReactNode }) {
  const { lang = i18n.defaultLanguage } = useParams({ strict: false });

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/*
         * Both colour schemes, written here rather than in the route head.
         *
         * `buildTagsFromMatches` in `@tanstack/react-router` de-duplicates meta
         * tags by `name` ("if (metaByAttribute[attribute]) continue"), so a pair of
         * `theme-color` entries declared in a route's `head` collapses to the last
         * one — which is how the dark value came to be missing from every built
         * page while `getRootHead` still declared it. The document shell is not
         * part of that pipeline, so both survive.
         *
         * The values mirror the production background token (`packages/ui`
         * `tokens.css`: `--background` light/dark) because a `meta` content cannot
         * carry `var()`. `root-theme.test.ts` reads both files and fails if they
         * drift apart. A `media` pair matches the theme while it follows the system
         * preference, which is what the Fumadocs provider defaults to
         * (`defaultTheme: "system"`, `enableSystem: true`); a manual override can
         * only be reflected by scripting, which this deliberately does not do.
         */}
        <meta name="theme-color" content="#f8f9fa" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#141618" media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      {/*
       * The design system's scope goes on the document body, not on `<html>`: the
       * dark token set is `.dark .lorelum-ui`, a descendant selector, and Fumadocs
       * puts `.dark` on `<html>` — so both classes on one element would never match
       * it. Carrying the scope here is what puts `body`, the margins around every
       * scoped column, and the shared chrome on the same production tokens as the
       * content; `styles/app.css` binds the `--color-fd-*` names to them once.
       */}
      <body className="lorelum-ui flex min-h-screen flex-col">
        <AppProviders lang={lang}>{children}</AppProviders>
        <Scripts />
      </body>
    </html>
  );
}
