import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNativeArtifactMatch,
  assertSourceNativeArtifactMatch,
  parseNativeArtifactManifest,
  verifyNativeArtifact,
  type NativeArtifactManifest,
} from "./manifest";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(contents = "native"): NativeArtifactManifest {
  return {
    schemaVersion: 1,
    buildIdentity: digest("build"),
    recipeIdentity: digest("recipe"),
    platform: "darwin",
    arch: "arm64",
    executable: "lore-model",
    source: { tag: "b10901", commit: "a".repeat(40), archiveSha256: digest("archive") },
    patchSha256: digest("patch"),
    toolchain: { cmake: "cmake", compiler: "clang" },
    cmakeFlags: ["-DTEST=ON"],
    model: { fileName: "granite-q4_0.gguf", bytes: 1, sha256: digest("model") },
    files: [{ path: "lore-model", bytes: Buffer.byteLength(contents), sha256: digest(contents) }],
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
      files: [{ ...fixture().files[0]!, path: "../lore-model" }],
    }),
  ).toThrow("safe file name");
});

test("native artifact match rejects a copied manifest that differs from the compiled one", () => {
  const expected = fixture();
  expect(() =>
    assertNativeArtifactMatch(expected, { ...expected, buildIdentity: digest("different-build") }),
  ).toThrow("differs from the compiled CLI manifest");
});

test("source native artifact match permits local compiler bytes but not a different recipe", () => {
  const expected = fixture();
  expect(() =>
    assertSourceNativeArtifactMatch(expected, {
      ...expected,
      buildIdentity: digest("local-compiler-build"),
      files: [{ ...expected.files[0]!, sha256: digest("locally-built-native") }],
      toolchain: { cmake: "cmake version local", compiler: "clang local" },
    }),
  ).not.toThrow();
  expect(() =>
    assertSourceNativeArtifactMatch(expected, {
      ...expected,
      recipeIdentity: digest("different-recipe"),
    }),
  ).toThrow("current source recipe");
  expect(() =>
    assertSourceNativeArtifactMatch(expected, {
      ...expected,
      patchSha256: digest("different-patch"),
    }),
  ).toThrow("current source recipe");
});

test.skipIf(process.platform === "win32")(
  "native artifact verification checks declared bytes, digests, mode and dependencies",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "lore-release-native-"));
    const contents = "native";
    try {
      const manifest = fixture(contents);
      await writeFile(join(directory, "lore-model"), contents);
      await chmod(join(directory, "lore-model"), 0o755);
      await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
      await expect(verifyNativeArtifact(directory)).resolves.toEqual(manifest);

      await writeFile(join(directory, "unexpected"), "unexpected");
      await expect(verifyNativeArtifact(directory)).rejects.toThrow("unexpected files");
      await rm(join(directory, "unexpected"));

      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({
          ...manifest,
          dynamicDependencies: ["/opt/local/lib/libunexpected.dylib"],
        }),
      );
      await expect(verifyNativeArtifact(directory)).rejects.toThrow(
        "unsupported dynamic dependency",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "linux artifacts validate against the linux system soname allowlist only",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "lore-release-native-linux-"));
    const contents = "native";
    try {
      const manifest: NativeArtifactManifest = {
        ...fixture(contents),
        platform: "linux",
        arch: "x64",
        dynamicDependencies: ["libc.so.6", "libstdc++.so.6"],
      };
      await writeFile(join(directory, "lore-model"), contents);
      await chmod(join(directory, "lore-model"), 0o755);
      await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
      await expect(verifyNativeArtifact(directory)).resolves.toEqual(manifest);

      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({ ...manifest, dynamicDependencies: ["/usr/lib/libSystem.B.dylib"] }),
      );
      // A darwin system path is not part of the linux allowlist.
      await expect(verifyNativeArtifact(directory)).rejects.toThrow(
        "unsupported dynamic dependency",
      );
      // Neither is an unexpected native library.
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({ ...manifest, dynamicDependencies: ["libcrypto.so.3"] }),
      );
      await expect(verifyNativeArtifact(directory)).rejects.toThrow(
        "unsupported dynamic dependency",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("win32 artifacts validate against the Windows system DLL allowlist only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-native-win32-"));
  const contents = "native";
  try {
    const manifest: NativeArtifactManifest = {
      ...fixture(contents),
      platform: "win32",
      arch: "x64",
      executable: "lore-model.exe",
      files: [
        { path: "lore-model.exe", bytes: Buffer.byteLength(contents), sha256: digest(contents) },
      ],
      dynamicDependencies: ["KERNEL32.dll", "ws2_32.dll"],
    };
    await writeFile(join(directory, "lore-model.exe"), contents);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    // Windows gates on the executable extension; POSIX mode bits never apply.
    await expect(verifyNativeArtifact(directory)).resolves.toEqual(manifest);

    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ ...manifest, dynamicDependencies: ["libstdc++-6.dll"] }),
    );
    // A bundled MinGW runtime DLL is not part of the Windows system allowlist.
    await expect(verifyNativeArtifact(directory)).rejects.toThrow("unsupported dynamic dependency");

    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ ...manifest, dynamicDependencies: ["KERNEL32.dll", "WS2_32.dll"] }),
    );
    // DLL names are compared case-insensitively.
    await expect(verifyNativeArtifact(directory)).resolves.toEqual(
      parseNativeArtifactManifest({
        ...manifest,
        dynamicDependencies: ["KERNEL32.dll", "WS2_32.dll"],
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
