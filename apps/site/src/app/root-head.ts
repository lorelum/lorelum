import appCss from "@/styles/app.css?url";

export function getRootHead() {
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // `theme-color` is deliberately not here: this pipeline de-duplicates meta
      // tags by `name`, so only one of a light/dark pair would survive. Both live
      // in the document shell instead — see `root-document.tsx`.
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/brand/lorelum-icon.svg",
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous" as const,
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600&display=swap",
      },
    ],
  };
}
