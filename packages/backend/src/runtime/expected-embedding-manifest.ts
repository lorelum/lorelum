import manifest from "../../../../native/embedding/artifacts/darwin-arm64.json";

/**
 * The checked-in manifest is used by source builds. The release compiler replaces
 * this module with the manifest produced by that same native build.
 */
export const expectedEmbeddingManifest = manifest;
