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
  expect(resolveEmbeddingNativeArtifact("freebsd", "x64")).toBeUndefined();
});

test("embedding artifact catalog owns the linux-x64 development, installed, and trusted-manifest paths", () => {
  const artifact = resolveEmbeddingNativeArtifact("linux", "x64");
  expect(artifact).toBeDefined();
  if (artifact === undefined) throw new Error("linux-x64 artifact is required");

  expect(artifact.id).toBe("linux-x64");
  expect(artifact.compileTarget).toBe("bun-linux-x64");
  expect(developmentEmbeddingArtifactDirectory(artifact)).toBe(
    resolve(import.meta.dir, "../../../..", ".artifacts", "native", "embedding", artifact.id),
  );
  expect(installedEmbeddingArtifactDirectory("/release", artifact)).toBe(
    join("/release", "native", artifact.id),
  );
  expect(trustedEmbeddingManifestPath(artifact)).toBe(join(import.meta.dir, "linux-x64.json"));
});

test("embedding artifact catalog owns the win32-x64 development, installed, and trusted-manifest paths", () => {
  const artifact = resolveEmbeddingNativeArtifact("win32", "x64");
  expect(artifact).toBeDefined();
  if (artifact === undefined) throw new Error("win32-x64 artifact is required");

  expect(artifact.id).toBe("win32-x64");
  expect(artifact.compileTarget).toBe("bun-windows-x64");
  expect(artifact.manifest.executable).toBe("lore-model.exe");
  expect(artifact.manifest.platform).toBe("win32");
  expect(developmentEmbeddingArtifactDirectory(artifact)).toBe(
    resolve(import.meta.dir, "../../../..", ".artifacts", "native", "embedding", artifact.id),
  );
  expect(installedEmbeddingArtifactDirectory("/release", artifact)).toBe(
    join("/release", "native", artifact.id),
  );
  expect(trustedEmbeddingManifestPath(artifact)).toBe(join(import.meta.dir, "win32-x64.json"));
});
