import { defineI18n } from 'fumadocs-core/i18n';

/**
 * Locales supported by the docs site.
 *
 * Content files use the dot parser: `index.mdx` (en) and `index.zh.mdx` (zh).
 */
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh'],
});
