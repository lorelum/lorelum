import { DEFAULT_EMBEDDING_SETTINGS } from "../config/embedding";
import { BACKEND_HOST } from "../protocol/constants";

const DEFAULT_CONTEXT_TOKENS = "2048";

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
    DEFAULT_CONTEXT_TOKENS,
    "-b",
    DEFAULT_CONTEXT_TOKENS,
    "-ub",
    DEFAULT_CONTEXT_TOKENS,
    "-np",
    "1",
    "--no-warmup",
  ];
}
