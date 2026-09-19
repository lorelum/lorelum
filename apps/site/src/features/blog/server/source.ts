import { loader } from "fumadocs-core/source";
import { i18n } from "@/shared/i18n/config";
import { blog } from "../content/registry";

export const blogSource = loader({
  source: blog.toFumadocsSource(),
  baseUrl: "/blog",
  i18n,
});
