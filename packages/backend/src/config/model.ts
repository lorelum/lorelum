import { z } from "zod";
import type { EmbeddingConfig } from "./embedding";

const timeout = z.number().int().min(1).max(120_000);
export const backendSettingsSchema = z.strictObject({
  startupTimeoutMs: timeout,
  requestTimeoutMs: timeout,
  shutdownTimeoutMs: timeout,
});
export type BackendSettings = Readonly<z.infer<typeof backendSettingsSchema>>;
export const DEFAULT_BACKEND_SETTINGS: BackendSettings = Object.freeze({
  startupTimeoutMs: 10_000,
  requestTimeoutMs: 5_000,
  shutdownTimeoutMs: 5_000,
});
export interface BackendConfig {
  readonly runtimeDirectory: string;
  readonly settings: BackendSettings;
  readonly embedding?: EmbeddingConfig;
}
export type Environment = Readonly<Record<string, string | undefined>>;
