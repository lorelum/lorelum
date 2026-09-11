import buildConfig from "../../../../../native/embedding/build-config.json";
import { createHash } from "node:crypto";

export const modelStates = ["unloaded", "loading", "ready", "unloading", "failed"] as const;
export const EMBEDDING_MODEL = Object.freeze({
  revision: "835ad14087e140460703cf0fae09f97d469d65c2",
  sha256: buildConfig.model.sha256,
  bytes: buildConfig.model.bytes,
  dimensions: 384,
  maxTokens: 512,
  maxInputs: 8,
});
export const ENCODING_ID = createHash("sha256")
  .update(
    JSON.stringify({
      ...EMBEDDING_MODEL,
      implementation: 1,
      pooling: "cls",
      normalization: "l2",
      prefix: "",
      specialTokens: true,
    }),
  )
  .digest("hex");
export type ModelState = (typeof modelStates)[number];
export interface EmbeddingResult {
  readonly encodingId: string;
  readonly vectors: number[][];
}

/** The service owns admission/state; this handle owns one native process lifetime. */
export interface EmbeddingRuntime {
  start(signal: AbortSignal, deadline: number): Promise<void>;
  tokenize(text: string, signal: AbortSignal): Promise<number[]>;
  encode(text: string, signal: AbortSignal): Promise<number[]>;
  stop(deadline: number): Promise<void>;
  readonly exited: Promise<void>;
}
