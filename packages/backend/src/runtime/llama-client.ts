import { readBoundedJson } from "../http/read-json";
import { BACKEND_HOST, MAX_RESPONSE_BYTES } from "../protocol/constants";
import { z } from "zod";
import { embeddingVectorSchema } from "../modules/embedding/dto";
import { EmbeddingError } from "../modules/embedding/errors";

const resultSchema = z.object({
  model: z.string(),
  data: z.array(z.object({ index: z.literal(0), embedding: embeddingVectorSchema })).length(1),
});

/** Only a spawned runtime supplies this endpoint and credential; never user config. */
export function createLlamaClient(port: number, secret: string, expectedAlias: string) {
  if (
    !expectedAlias ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[a-f0-9]{64}$/.test(secret)
  )
    throw new EmbeddingError("embedding.failed");
  async function send(
    path: string,
    body: unknown,
    signal: AbortSignal,
    limit = MAX_RESPONSE_BYTES,
  ): Promise<unknown> {
    try {
      const response = await fetch(`http://${BACKEND_HOST}:${port}${path}`, {
        method: "POST",
        proxy: "",
        redirect: "error",
        signal,
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new EmbeddingError("embedding.failed");
      }
      return await readBoundedJson(response, limit);
    } catch (error) {
      if (signal.aborted) throw new EmbeddingError("embedding.deadline-exceeded");
      throw error instanceof EmbeddingError ? error : new EmbeddingError("embedding.failed");
    }
  }
  return {
    async encode(text: string, signal: AbortSignal): Promise<number[]> {
      const result = resultSchema.safeParse(
        await send("/v1/embeddings", { input: [text], encoding_format: "float" }, signal),
      );
      if (!result.success || result.data.model !== expectedAlias)
        throw new EmbeddingError("embedding.failed");
      return result.data.data[0]!.embedding;
    },
  };
}
