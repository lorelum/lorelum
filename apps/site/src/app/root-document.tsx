import { HeadContent, Scripts, useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { i18n } from '@/shared/i18n/config';
import { AppProviders } from './providers';

export function RootDocument({ children }: { children: ReactNode }) {
  const { lang = i18n.defaultLanguage } = useParams({ strict: false });

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <AppProviders lang={lang}>{children}</AppProviders>
        <Scripts />
      </body>
    </html>
  );
}
