const origin = process.env.SITE_URL ?? process.env.CF_PAGES_URL ?? "https://lorelum.com";

export const siteUrl = origin.replace(/\/$/, "");

export const docsRoute = "/docs";
