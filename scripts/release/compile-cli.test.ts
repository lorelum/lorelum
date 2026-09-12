import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveEmbeddingNativeArtifact,
  trustedEmbeddingManifestPath,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import type { NativeArtifactManifest } from "../../packages/backend/src/runtime/native/embedding/manifest";
import { compileReleaseCli } from "./compile-cli";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const artifact = resolveEmbeddingNativeArtifact("darwin", "arm64");
if (artifact === undefined) throw new Error("darwin-arm64 artifact is required");

const manifest: NativeArtifactManifest = {
  schemaVersion: 1,
  buildIdentity: digest("release-build"),
  recipeIdentity: digest("recipe"),
  platform: "darwin",
  arch: "arm64",
  executable: "llama-server",
  source: { tag: "b10901", commit: "a".repeat(40), archiveSha256: digest("archive") },
  patchSha256: digest("patch"),
  toolchain: { cmake: "cmake", compiler: "clang" },
  cmakeFlags: [],
  model: { fileName: "granite-q4_0.gguf", bytes: 1, sha256: digest("model") },
  files: [{ path: "llama-server", bytes: 1, sha256: digest("native") }],
  licenses: [],
  dynamicDependencies: ["/usr/lib/libSystem.B.dylib"],
};

test("release compiler embeds its supplied manifest and disables cwd dotenv discovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-compile-"));
  try {
    const manifestArtifact = join(directory, "expected-manifest.json");
    const entrypoint = join(directory, "entry.ts");
    const executable = join(directory, "fixture");
    await writeFile(manifestArtifact, JSON.stringify({ buildIdentity: "source-build" }));
    await writeFile(
      entrypoint,
      [
        'import manifest from "./expected-manifest.json";',
        'console.log(`${manifest.buildIdentity}:${process.env.LORELUM_RELEASE_TEST ?? "unset"}`);',
      ].join("\n"),
    );
    await writeFile(join(directory, ".env"), "LORELUM_RELEASE_TEST=from-dotenv\n");

    await compileReleaseCli({
      nativeManifest: manifest,
      outfile: executable,
      entrypoint,
      manifestArtifact,
      artifact,
      target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
    });
    const child = Bun.spawn([executable], { cwd: directory, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(`${manifest.buildIdentity}:unset`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release compiler replaces the embedding catalog's trusted manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-catalog-"));
  const releaseManifest = { ...manifest, buildIdentity: digest("catalog-release-build") };
  try {
    const entrypoint = join(directory, "entry.ts");
    const executable = join(directory, "fixture");
    await writeFile(
      entrypoint,
      [
        `import manifest from ${JSON.stringify(trustedEmbeddingManifestPath(artifact))};`,
        "console.log(manifest.buildIdentity);",
      ].join("\n"),
    );

    await compileReleaseCli({
      nativeManifest: releaseManifest,
      outfile: executable,
      entrypoint,
      artifact,
      target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
    });
    const child = Bun.spawn([executable], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(releaseManifest.buildIdentity);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
