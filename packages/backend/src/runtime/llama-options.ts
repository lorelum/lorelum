import { DEFAULT_EMBEDDING_SETTINGS } from "../config/embedding";
import { EMBEDDING_MODEL } from "../modules/embedding/model";
import { BACKEND_HOST } from "../protocol/constants";

/** Production and explicit native tests use the same fixed CPU encoding recipe. */
export function llamaArguments(
  modelPath: string,
  port: number,
  alias: string,
  options: { threads?: number | undefined; maxTokens?: number | undefined } = {},
): string[] {
  const tokenLimit = String(options.maxTokens ?? EMBEDDING_MODEL.maxTokens);
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
    tokenLimit,
    "-b",
    tokenLimit,
    "-ub",
    tokenLimit,
    "-np",
    "1",
    "--no-warmup",
  ];
}
