import { join } from "node:path";

import { SEMANTIC_INDEX_VERSION } from "./metadata";

const INDEX_FILE_NAME = "active.sqlite";
const WRITER_DIRECTORY = "writer";

export interface SemanticIndexPaths {
  readonly directory: string;
  readonly active: string;
  readonly writer: string;
}

/** Derive all Store-local paths for one fixed semantic Profile. */
export function semanticIndexPaths(rootPath: string, profileId: string): SemanticIndexPaths {
  const directory = join(rootPath, "indexes", "semantic", `v${SEMANTIC_INDEX_VERSION}`, profileId);
  return Object.freeze({
    directory,
    active: join(directory, INDEX_FILE_NAME),
    writer: join(directory, WRITER_DIRECTORY),
  });
}
