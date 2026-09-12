import { EMBEDDING_MODEL } from "../embedding/model";
import type { EmbeddingService } from "../embedding/service";
import type { EmbeddingPort } from "@lorelum/engine";

/** Adapts the daemon's in-process model service to Engine's dependency-only port. */
export function createEmbeddingAdapter(service: EmbeddingService): EmbeddingPort {
  return Object.freeze({
    maxBatchSize: EMBEDDING_MODEL.maxInputs,
    embed: (inputs: readonly string[]) => service.embed("document", inputs),
  });
}

/** Adapts the same daemon-lifetime model to semantic query inputs. */
export function createQueryEmbeddingAdapter(service: EmbeddingService): EmbeddingPort {
  return Object.freeze({
    maxBatchSize: 1,
    embed: (inputs: readonly string[]) => service.embed("query", inputs),
  });
}
