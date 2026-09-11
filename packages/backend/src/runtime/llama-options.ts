import { EMBEDDING_MODEL } from "../modules/embedding/model";
import { BACKEND_HOST } from "../protocol/constants";

const CPU_THREADS = 4;
const tokenLimit = String(EMBEDDING_MODEL.maxTokens);

/** Production and explicit native tests use the same fixed CPU encoding recipe. */
export function llamaArguments(modelPath: string, port: number, alias: string): string[] {
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
    String(CPU_THREADS),
    "-tb",
    String(CPU_THREADS),
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
