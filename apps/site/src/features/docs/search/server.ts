import { createFromSource } from "fumadocs-core/search/server";
import { source } from "../server/source";

const searchServer = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: "english",
});

/** Handles the existing Docs search HTTP endpoint. */
export function searchDocs(request: Request) {
  return searchServer.GET(request);
}
