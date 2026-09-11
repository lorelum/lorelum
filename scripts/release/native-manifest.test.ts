import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNativeArtifactMatch,
  parseNativeArtifactManifest,
  verifyNativeArtifact,
  type NativeArtifactManifest,
} from "./native-manifest";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(contents = "native"): NativeArtifactManifest {
  return {
    schemaVersion: 1,
    buildIdentity: digest("build"),
    recipeIdentity: digest("recipe"),
    platform: "darwin",
    arch: "arm64",
    executable: "llama-server",
    source: { tag: "b10901", commit: "a".repeat(40), archiveSha256: digest("archive") },
    patchSha256: digest("patch"),
    toolchain: { cmake: "cmake", compiler: "clang" },
    cmakeFlags: ["-DTEST=ON"],
    model: { fileName: "granite-q4_0.gguf", bytes: 1, sha256: digest("model") },
    files: [{ path: "llama-server", bytes: Buffer.byteLength(contents), sha256: digest(contents) }],
    licenses: [],
    dynamicDependencies: ["/usr/lib/libSystem.B.dylib"],
  };
}

test("native manifest rejects unknown fields and unsafe paths", () => {
  expect(() => parseNativeArtifactManifest({ ...fixture(), extra: true })).toThrow(
    "manifest contains unknown fields",
  );
  expect(() =>
    parseNativeArtifactManifest({
      ...fixture(),
      files: [{ ...fixture().files[0]!, path: "../llama-server" }],
    }),
  ).toThrow("safe file name");
});

test("native artifact match rejects a copied manifest that differs from the compiled one", () => {
  const expected = fixture();
  expect(() =>
    assertNativeArtifactMatch(expected, { ...expected, buildIdentity: digest("different-build") }),
  ).toThrow("differs from the compiled CLI manifest");
});

test("native artifact verification checks declared bytes, digests, mode and dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-native-"));
  const contents = "native";
  try {
    const manifest = fixture(contents);
    await writeFile(join(directory, "llama-server"), contents);
    await chmod(join(directory, "llama-server"), 0o755);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    await expect(verifyNativeArtifact(directory)).resolves.toEqual(manifest);

    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ ...manifest, dynamicDependencies: ["/opt/local/lib/libunexpected.dylib"] }),
    );
    await expect(verifyNativeArtifact(directory)).rejects.toThrow("unsupported dynamic dependency");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
