import buildConfig from "../../../../../native/embedding/build-config.json";

export const modelStates = ["unloaded", "loading", "ready", "unloading", "failed"] as const;
export const EMBEDDING_MODEL = Object.freeze({
  revision: "835ad14087e140460703cf0fae09f97d469d65c2",
  sha256: buildConfig.model.sha256,
  bytes: buildConfig.model.bytes,
  dimensions: 384,
  maxInputs: 8,
});
/**
 * Fixed identity for the pinned model and encoding recipe. Keep this value when changing an
 * operational setting so existing semantic indexes retain their Profile directory.
 */
export const ENCODING_ID = "ed34b3105cb6c3ab217fdb7b7c926c05808bd47474468c2f74a5110a590a42de";
export type ModelState = (typeof modelStates)[number];
export interface EmbeddingResult {
  readonly encodingId: string;
  readonly vectors: number[][];
}

/** The service owns admission/state; this handle owns one native process lifetime. */
export interface EmbeddingRuntime {
  start(signal: AbortSignal, deadline: number): Promise<void>;
  encode(text: string, signal: AbortSignal): Promise<number[]>;
  stop(deadline: number): Promise<void>;
  readonly exited: Promise<void>;
}
