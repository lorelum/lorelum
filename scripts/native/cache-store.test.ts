import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeArtifactManifest } from "../../packages/backend/src/runtime/native/embedding/manifest";
import { nativeBuildCacheEntryDirectory } from "./cache-paths";
import { materializeNativeBuildCache } from "./cache-store";

const cacheKey = "a".repeat(64);
const target = "darwin-arm64";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(contents: string): NativeArtifactManifest {
  return {
    schemaVersion: 1,
    buildIdentity: digest(`build:${contents}`),
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

async function writeArtifact(directory: string, contents: string): Promise<NativeArtifactManifest> {
  const manifest = fixture(contents);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "llama-server"), contents);
  await chmod(join(directory, "llama-server"), 0o755);
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "lore-native-cache-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function cacheOptions(
  cacheRoot: string,
  candidateDirectory: string,
  build: (directory: string) => Promise<void>,
  report = () => undefined,
) {
  return {
    cacheRoot,
    target,
    cacheKey,
    candidateDirectory,
    validate: (_manifest: NativeArtifactManifest) => undefined,
    build,
    report,
  };
}

test("native build cache builds once then materializes a verified artifact for another worktree", async () => {
  await withTemporaryDirectory(async (root) => {
    const cacheRoot = join(root, "cache");
    const firstCandidate = join(root, "worktree-one", "candidate");
    const secondCandidate = join(root, "worktree-two", "candidate");
    const reports: string[] = [];
    let builds = 0;
    const build = async (directory: string) => {
      builds += 1;
      await writeArtifact(directory, "first build");
    };

    const first = await materializeNativeBuildCache(
      cacheOptions(cacheRoot, firstCandidate, build, (message) => reports.push(message)),
    );
    const second = await materializeNativeBuildCache(
      cacheOptions(cacheRoot, secondCandidate, build, (message) => reports.push(message)),
    );

    expect(builds).toBe(1);
    expect(second).toEqual(first);
    expect(await readFile(join(secondCandidate, "llama-server"), "utf8")).toBe("first build");
    expect(reports.some((message) => message.includes("cache miss"))).toBe(true);
    expect(reports.some((message) => message.includes("cache hit"))).toBe(true);
  });
});

test("native build cache discards a corrupted entry and rebuilds it", async () => {
  await withTemporaryDirectory(async (root) => {
    const cacheRoot = join(root, "cache");
    let builds = 0;
    const build = async (directory: string) => {
      builds += 1;
      await writeArtifact(directory, `build ${builds}`);
    };
    await materializeNativeBuildCache(cacheOptions(cacheRoot, join(root, "first"), build));
    const entry = nativeBuildCacheEntryDirectory(cacheRoot, target, cacheKey);
    await writeFile(join(entry, "llama-server"), "corrupted");

    const rebuilt = await materializeNativeBuildCache(
      cacheOptions(cacheRoot, join(root, "second"), build),
    );

    expect(builds).toBe(2);
    expect(await readFile(join(root, "second", "llama-server"), "utf8")).toBe("build 2");
    expect(rebuilt.buildIdentity).toBe(fixture("build 2").buildIdentity);
  });
});

test("concurrent worktrees wait for one native cache build", async () => {
  await withTemporaryDirectory(async (root) => {
    const cacheRoot = join(root, "cache");
    let builds = 0;
    const build = async (directory: string) => {
      builds += 1;
      await Bun.sleep(75);
      await writeArtifact(directory, "shared build");
    };
    const [first, second] = await Promise.all([
      materializeNativeBuildCache(cacheOptions(cacheRoot, join(root, "first"), build)),
      materializeNativeBuildCache(cacheOptions(cacheRoot, join(root, "second"), build)),
    ]);

    expect(builds).toBe(1);
    expect(first.buildIdentity).toBe(second.buildIdentity);
    expect(await readFile(join(root, "first", "llama-server"), "utf8")).toBe("shared build");
    expect(await readFile(join(root, "second", "llama-server"), "utf8")).toBe("shared build");
  });
});
