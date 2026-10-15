import { HeadContent, Scripts, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { i18n } from "@/shared/i18n/config";
import { AppProviders } from "./providers";

export function RootDocument({ children }: { children: ReactNode }) {
  const { lang = i18n.defaultLanguage } = useParams({ strict: false });

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/* Keep both schemes outside the router head, which deduplicates meta by name.
            Values mirror the production background tokens; media follows the system theme. */}
        <meta name="theme-color" content="#f8f9fa" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#141618" media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      {/* Dark tokens require `.dark` on an ancestor of the design-system scope. */}
      <body className="lorelum-ui flex min-h-screen flex-col">
        <AppProviders lang={lang}>{children}</AppProviders>
        <Scripts />
      </body>
    </html>
  );
}
