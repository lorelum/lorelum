import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { shouldPrerenderPage } from "./prerender-path-filter";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      prerender: {
        enabled: true,
        // The prerenderer names a page's file by its path with the query
        // stripped, so a crawled `/blog?category=…` writes to the same
        // `blog/index.html` as the plain index — and being rendered later, it
        // wins, replacing the canonical page with one filtered view's HTML
        // (every sidebar link on it then carrying that filter). Query URLs are
        // states of a dynamic index, not pages of their own: they are excluded
        // from prerendering and render on request, which is how an unknown
        // `?category=` already behaves.
        filter: shouldPrerenderPage,
      },
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.js",
    },
  },
});
