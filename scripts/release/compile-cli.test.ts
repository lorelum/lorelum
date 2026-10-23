import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PROTOCOL_VERSION } from "../../packages/backend/src/protocol/constants";
import { protocolVersion, toolVersion } from "../../packages/cli/src/output/protocol";
import { readBuildProvenance } from "../../packages/backend/src/runtime/build-info";
import { resolveEmbeddingNativeArtifact } from "../../packages/backend/src/runtime/native/embedding/catalog";
import type { NativeArtifactManifest } from "../../packages/backend/src/runtime/native/embedding/manifest";
import { compileCli, compileReleaseCli, windowsCompileMetadataArguments } from "./compile-cli";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const repositoryRoot = resolve(import.meta.dir, "../..");
const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
if (artifact === undefined)
  throw new Error(`current platform artifact is required: ${process.platform}-${process.arch}`);

const manifest: NativeArtifactManifest = {
  schemaVersion: 1,
  buildIdentity: digest("release-build"),
  recipeIdentity: digest("recipe"),
  platform: artifact.platform,
  arch: artifact.arch,
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

compileTest(
  "compiled build info survives copies and separates rebuilds without Git at runtime",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "lore-build-identity-"));
    try {
      const emptyPath = join(directory, "empty-path");
      await mkdir(emptyPath);
      const entrypoint = join(directory, "entry.ts");
      await writeFile(
        entrypoint,
        [
          `import { createVersionData } from ${JSON.stringify(
            join(repositoryRoot, "packages/cli/src/version.ts"),
          )};`,
          "console.log(JSON.stringify(await createVersionData(import.meta.path)));",
        ].join("\n"),
      );
      const expectedProvenance = await readBuildProvenance(repositoryRoot, toolVersion, "compiled");
      const first = await compileCli({ entrypoint, outfile: join(directory, "first") });
      const copied = join(directory, process.platform === "win32" ? "copied.exe" : "copied");
      await copyFile(first.output, copied);
      const second = await compileReleaseCli({
        entrypoint,
        outfile: join(directory, "second"),
        artifact,
        nativeManifest: manifest,
        useBunCommand: true,
      });
      const buildInfos = [first.output, first.output, copied, second.output].map((executable) => {
        const child = Bun.spawnSync([executable], {
          cwd: directory,
          env: { ...process.env, PATH: emptyPath },
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(child.exitCode).toBe(0);
        expect(child.stderr.toString()).toBe("");
        return JSON.parse(child.stdout.toString()) as Record<string, unknown>;
      });
      expect(buildInfos[0]).toMatchObject({
        ...expectedProvenance,
        protocolVersion,
        backendProtocolVersion: PROTOCOL_VERSION,
        toolVersion,
        buildKind: "compiled",
      });
      expect(buildInfos[0]?.buildIdentity).toMatch(/^[a-f0-9]{64}$/);
      expect(buildInfos[1]).toEqual(buildInfos[0]);
      expect(buildInfos[2]).toEqual(buildInfos[0]);
      expect(buildInfos[3]).toMatchObject(expectedProvenance);
      expect(buildInfos[3]?.buildIdentity).toMatch(/^[a-f0-9]{64}$/);
      expect(buildInfos[3]?.buildIdentity).not.toBe(buildInfos[0]?.buildIdentity);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

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
      const entrypoint = join(directory, "entry.ts");
      const executable = join(directory, "fixture");
      await writeFile(
        entrypoint,
        [
          `import { resolveEmbeddingNativeArtifact } from ${JSON.stringify(
            join(repositoryRoot, "packages/backend/src/runtime/native/embedding/catalog.ts"),
          )};`,
          "const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);",
          'console.log(`${artifact?.manifest.buildIdentity}:${process.env.LORELUM_RELEASE_TEST ?? "unset"}`);',
        ].join("\n"),
      );
      await writeFile(join(directory, ".env"), "LORELUM_RELEASE_TEST=from-dotenv\n");

      const compiled = await compileReleaseCli({
        nativeManifest: manifest,
        outfile: executable,
        entrypoint,
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

compileTest("Windows-compatible CLI compiler replaces the embedding catalog manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-catalog-"));
  const releaseManifest = { ...manifest, buildIdentity: digest("catalog-release-build") };
  try {
    const entrypoint = join(directory, "entry.ts");
    const executable = join(directory, "fixture");
    await writeFile(
      entrypoint,
      [
        `import { resolveEmbeddingNativeArtifact } from ${JSON.stringify(
          join(repositoryRoot, "packages/backend/src/runtime/native/embedding/catalog.ts"),
        )};`,
        "console.log(resolveEmbeddingNativeArtifact(process.platform, process.arch)?.manifest.buildIdentity);",
      ].join("\n"),
    );

    const compiled = await compileReleaseCli({
      nativeManifest: releaseManifest,
      outfile: executable,
      entrypoint,
      artifact,
      target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
      useBunCommand: true,
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
      const entrypoint = join(directory, "entry.ts");
      const executable = join(directory, "fixture");
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

compileTest("release compiler maps a binary stack back to TypeScript source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-sourcemap-"));
  try {
    const entrypoint = join(directory, "source-mapped-fixture.ts");
    const executable = join(directory, "fixture");
    await writeFile(
      entrypoint,
      [
        "function sourceMappedFailure(): never {",
        '  throw new Error("source-mapped-fixture");',
        "}",
        "sourceMappedFailure();",
      ].join("\n"),
    );
    const compiled = await compileReleaseCli({
      nativeManifest: manifest,
      outfile: executable,
      entrypoint,
      artifact,
      target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
    });
    const child = Bun.spawn([compiled.output], { stdout: "pipe", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/source-mapped-fixture\.ts:2:\d+/);
    expect(stderr).not.toContain("$bunfs");
    expect(stderr).not.toContain(".release-bundle.js");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

compileTest("release compiler preserves a source-mapped serialized Error stack", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-serialized-stack-"));
  try {
    const entrypoint = join(directory, "serialized-stack-fixture.ts");
    const executable = join(directory, "fixture");
    await writeFile(
      entrypoint,
      [
        `import { createLogRecord } from ${JSON.stringify(
          join(repositoryRoot, "packages/log/src/record.ts"),
        )};`,
        "const record = createLogRecord({",
        '  level: "error",',
        '  source: "fixture",',
        '  message: "fixture.failed",',
        '  error: new Error("serialized-stack-fixture"),',
        "});",
        "console.error(record.error?.stack);",
      ].join("\n"),
    );
    const compiled = await compileReleaseCli({
      nativeManifest: manifest,
      outfile: executable,
      entrypoint,
      artifact,
      target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
    });
    const child = Bun.spawn([compiled.output], { stdout: "pipe", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("serialized-stack-fixture");
    expect(stderr).toMatch(/serialized-stack-fixture\.ts:6:\d+/);
    expect(stderr).not.toContain("$bunfs");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

compileTest(
  "Windows-compatible CLI compiler maps a binary stack back to TypeScript source",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "lore-release-cli-sourcemap-"));
    try {
      const entrypoint = join(directory, "source-mapped-cli-fixture.ts");
      const executable = join(directory, "fixture");
      await writeFile(
        entrypoint,
        [
          "function sourceMappedCliFailure(): never {",
          '  throw new Error("source-mapped-cli-fixture");',
          "}",
          "sourceMappedCliFailure();",
        ].join("\n"),
      );
      const compiled = await compileReleaseCli({
        nativeManifest: manifest,
        outfile: executable,
        entrypoint,
        artifact,
        target: `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget,
        useBunCommand: true,
      });
      const child = Bun.spawn([compiled.output], { stdout: "pipe", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/source-mapped-cli-fixture\.ts:2:\d+/);
      expect(stderr).not.toContain("$bunfs");
      expect(stderr).not.toContain(".release-bundle.js");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
