import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  developmentEmbeddingArtifactDirectory,
  installedEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
  trustedEmbeddingManifestPath,
} from "./catalog";

test("embedding artifact catalog owns the development, installed, and trusted-manifest paths", () => {
  const artifact = resolveEmbeddingNativeArtifact("darwin", "arm64");
  expect(artifact).toBeDefined();
  if (artifact === undefined) throw new Error("darwin-arm64 artifact is required");

  expect(artifact.id).toBe("darwin-arm64");
  expect(developmentEmbeddingArtifactDirectory(artifact)).toBe(
    resolve(import.meta.dir, "../../../..", ".artifacts", "native", "embedding", artifact.id),
  );
  expect(installedEmbeddingArtifactDirectory("/release", artifact)).toBe(
    join("/release", "native", artifact.id),
  );
  expect(trustedEmbeddingManifestPath(artifact)).toBe(join(import.meta.dir, "darwin-arm64.json"));
});

test("embedding artifact catalog rejects an unsupported platform instead of selecting another target", () => {
  expect(resolveEmbeddingNativeArtifact("win32", "x64")).toBeUndefined();
});
