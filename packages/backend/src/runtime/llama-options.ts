import { DEFAULT_EMBEDDING_SETTINGS } from "../config/embedding";
import { BACKEND_HOST } from "../protocol/constants";

const CONTEXT_TOKENS_PER_SLOT = 2048;
const NATIVE_BATCH_SLOTS = 2;

/** Production and explicit native tests use the same fixed CPU encoding recipe. */
export function llamaArguments(
  modelPath: string,
  port: number,
  alias: string,
  options: { threads?: number | undefined } = {},
): string[] {
  const threads = String(options.threads ?? DEFAULT_EMBEDDING_SETTINGS.threads);
  return [
    "-m",
    modelPath,
    "--alias",
    alias,
    "--host",
    BACKEND_HOST,
    "--port",
    String(port),
    "--embedding",
    "--pooling",
    "cls",
    "--embd-normalize",
    "2",
    "--device",
    "none",
    "--no-op-offload",
    "-ngl",
    "0",
    "-t",
    threads,
    "-tb",
    threads,
    "-c",
    String(CONTEXT_TOKENS_PER_SLOT * NATIVE_BATCH_SLOTS),
    "-b",
    String(CONTEXT_TOKENS_PER_SLOT),
    "-ub",
    String(CONTEXT_TOKENS_PER_SLOT),
    "-np",
    String(NATIVE_BATCH_SLOTS),
    "--no-warmup",
  ];
}
