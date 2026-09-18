import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveEmbeddingNativeArtifact,
  trustedEmbeddingManifestPath,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import type { NativeArtifactManifest } from "../../packages/backend/src/runtime/native/embedding/manifest";
import { compileReleaseCli, windowsCompileMetadataArguments } from "./compile-cli";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const repositoryRoot = resolve(import.meta.dir, "../..");
const artifact = resolveEmbeddingNativeArtifact("darwin", "arm64");
if (artifact === undefined) throw new Error("darwin-arm64 artifact is required");

const manifest: NativeArtifactManifest = {
  schemaVersion: 1,
  buildIdentity: digest("release-build"),
  recipeIdentity: digest("recipe"),
  platform: "darwin",
  arch: "arm64",
  executable: "lore-model",
  source: { tag: "b10901", commit: "a".repeat(40), archiveSha256: digest("archive") },
  patchSha256: digest("patch"),
  toolchain: { cmake: "cmake", compiler: "clang" },
  cmakeFlags: [],
  model: { fileName: "granite-q4_0.gguf", bytes: 1, sha256: digest("model") },
  files: [{ path: "lore-model", bytes: 1, sha256: digest("native") }],
  licenses: [],
  dynamicDependencies: ["/usr/lib/libSystem.B.dylib"],
};

// Each case runs `bun build --compile`, and a cold compile alone can exceed the
// 5000ms test default on slower machines, so give the cases an explicit budget.
const compileTimeoutMs = 30_000;

function compileTest(name: string, fn: () => Promise<void>): void {
  test(name, fn, compileTimeoutMs);
}

test("Windows release compiler uses the checked-in Lorelum icon and product metadata", () => {
  const compileArguments = windowsCompileMetadataArguments();
  expect(existsSync(join(repositoryRoot, "scripts/release/lorelum.ico"))).toBe(true);
  expect(compileArguments).toEqual([
    `--windows-icon=${join(repositoryRoot, "scripts/release/lorelum.ico")}`,
    "--windows-title=Lorelum",
    "--windows-description=Lorelum local knowledge retrieval CLI",
  ]);
});

compileTest(
  "release compiler embeds its supplied manifest and disables cwd dotenv discovery",
  async () => {
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

      const compiled = await compileReleaseCli({
        nativeManifest: manifest,
        outfile: executable,
        entrypoint,
        manifestArtifact,
        artifact,
        target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
      });
      const child = Bun.spawn([compiled.output], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
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
  },
);

compileTest("release compiler replaces the embedding catalog's trusted manifest", async () => {
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

    const compiled = await compileReleaseCli({
      nativeManifest: releaseManifest,
      outfile: executable,
      entrypoint,
      artifact,
      target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
    });
    const child = Bun.spawn([compiled.output], { stdout: "pipe", stderr: "pipe" });
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

compileTest(
  "release compiler embeds ProjectContext cache migrations for cold initialization",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "lore-release-migrations-"));
    try {
      const manifestArtifact = join(directory, "expected-manifest.json");
      const entrypoint = join(directory, "entry.ts");
      const executable = join(directory, "fixture");
      await writeFile(manifestArtifact, JSON.stringify({ buildIdentity: "source-build" }));
      await writeFile(
        entrypoint,
        [
          'import { Database } from "bun:sqlite";',
          `import { createSqliteConnection, projectKeywordIndexDatabaseDefinition, migrateSqlite } from ${JSON.stringify(join(repositoryRoot, "packages/engine/src/persistence/index.ts"))};`,
          'const connection = createSqliteConnection(new Database(":memory:"), projectKeywordIndexDatabaseDefinition.schema);',
          "migrateSqlite(connection, projectKeywordIndexDatabaseDefinition);",
          "console.log(connection.client.query(\"SELECT name FROM sqlite_master WHERE name = 'keyword_documents'\").get().name);",
          "connection.close();",
        ].join("\n"),
      );

      const compiled = await compileReleaseCli({
        nativeManifest: manifest,
        outfile: executable,
        entrypoint,
        manifestArtifact,
        artifact,
        target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
      });
      const child = Bun.spawn([compiled.output], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("keyword_documents");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
