import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileReleaseCli } from "./compile-cli";
import type { NativeArtifactManifest } from "./native-manifest";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

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
    const manifestModule = join(directory, "expected-manifest.ts");
    const entrypoint = join(directory, "entry.ts");
    const executable = join(directory, "fixture");
    await writeFile(
      manifestModule,
      'export const expectedEmbeddingManifest = { buildIdentity: "source-build" };\n',
    );
    await writeFile(
      entrypoint,
      [
        'import { expectedEmbeddingManifest } from "./expected-manifest.ts";',
        'console.log(`${expectedEmbeddingManifest.buildIdentity}:${process.env.LORELUM_RELEASE_TEST ?? "unset"}`);',
      ].join("\n"),
    );
    await writeFile(join(directory, ".env"), "LORELUM_RELEASE_TEST=from-dotenv\n");

    await compileReleaseCli({
      nativeManifest: manifest,
      outfile: executable,
      entrypoint,
      manifestModule,
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
