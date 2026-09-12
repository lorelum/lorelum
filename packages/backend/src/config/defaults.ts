import { DEFAULT_BACKEND_SETTINGS } from "./model";
import { embeddingConfigSchema } from "./embedding";

/** Defaults for the sections this consumer owns; application bootstrap decides when to persist. */
export function defaultBackendConfigSections() {
  const { threads, download } = embeddingConfigSchema.parse({});
  return { backend: DEFAULT_BACKEND_SETTINGS, embedding: { threads, download } };
}
