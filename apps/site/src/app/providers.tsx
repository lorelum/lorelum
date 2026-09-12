import type { ReactNode } from "react";
import { zhCN } from "@fumadocs/language/zh-cn";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { i18n } from "@/shared/i18n/config";

const translations = i18n.translations().extend(uiTranslations()).preset("zh", zhCN());

export function AppProviders({ children, lang }: { children: ReactNode; lang: string }) {
  return <RootProvider i18n={i18nProvider(translations, lang)}>{children}</RootProvider>;
}
