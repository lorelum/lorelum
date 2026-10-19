import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEmbeddingConfig } from "../config/embedding";
import {
  prepareEmbeddingResources,
  resolveCompiledEmbeddingResourceRoot,
  verifyNativeEmbeddingResources,
} from "./embedding-resources";
import { verifyResource } from "./resource-integrity";
import { resolveEmbeddingNativeArtifact } from "./native/embedding/catalog";
import { verifyNativeArtifact } from "./native/embedding/manifest";

/** File symlinks need Developer Mode or elevation on Windows; probe once instead of assuming. */
async function canCreateSymlinks(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const directory = await mkdtemp(join(tmpdir(), "lore-symlink-probe-"));
  try {
    const target = join(directory, "target");
    await writeFile(target, "fixture");
    await symlink(target, join(directory, "link"));
    return true;
  } catch {
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Real manifest and executable bytes matching the current source recipe, not a native mock. */
async function nativeFixture(directory: string) {
  const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
  if (!artifact) throw new Error("resource tests require a supported native target");
  const content = "native fixture";
  const manifest = {
    ...artifact.manifest,
    buildIdentity: createHash("sha256").update(content).digest("hex"),
    files: artifact.manifest.files.map((file) =>
      file.path === artifact.manifest.executable
        ? {
            ...file,
            bytes: Buffer.byteLength(content),
            sha256: createHash("sha256").update(content).digest("hex"),
          }
        : file,
    ),
  };
  const executable = join(directory, manifest.executable);
  await writeFile(executable, content);
  await chmod(executable, 0o755);
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  return { artifact, manifest, executable };
}

test("compiled resource lookup resolves the executable symlink before finding native files", async () => {
  const withSymlinks = await canCreateSymlinks();
  const directory = await mkdtemp(join(tmpdir(), "lore-resource-root-"));
  try {
    const installed = join(directory, "installed");
    const bin = join(directory, "bin");
    await mkdir(installed, { recursive: true });
    await mkdir(bin);
    const executable = join(installed, "lore");
    const link = join(bin, "lore");
    await writeFile(executable, "fixture");
    if (!withSymlinks) return;
    await symlink(executable, link);
    await expect(resolveCompiledEmbeddingResourceRoot(link)).resolves.toBe(
      await realpath(installed),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preparation rejects wrong model size and digest with safe logical resource details", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-resource-detail-"));
  const path = join(root, "model.gguf");
  const digest = createHash("sha256").update("correct").digest("hex");
  const resource = { kind: "model", file: "model.gguf" } as const;
  try {
    await writeFile(path, "invalid");
    await expect(
      verifyResource(path, 6, digest, new AbortController().signal, resource),
    ).rejects.toMatchObject({
      code: "embedding.resource-invalid",
      resource: { ...resource, check: "size-mismatch", expected: "6", actual: "7" },
    });
    await expect(
      verifyResource(path, 7, digest, new AbortController().signal, resource),
    ).rejects.toMatchObject({
      code: "embedding.resource-invalid",
      resource: {
        ...resource,
        check: "sha256-mismatch",
        expected: digest,
        actual: createHash("sha256").update("invalid").digest("hex"),
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing compiled native resources fail before any model transfer or cache creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-missing-native-"));
  const cacheDirectory = join(root, "cache");
  try {
    await expect(
      prepareEmbeddingResources(
        resolveEmbeddingConfig({ cacheDirectory }),
        new AbortController().signal,
        () => {},
        {
          compiledRoot: root,
          model: {
            download: async () => {
              throw new Error("missing native must fail before transfer");
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "embedding.native-resource-invalid",
      resource: {
        kind: "native",
        file: `native/${process.platform}-${process.arch}/manifest.json`,
        check: "missing",
      },
    });
    await expect(lstat(cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native preparation accepts missing notices while full build validation rejects them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-native-notices-"));
  try {
    const { executable, manifest } = await nativeFixture(directory);
    await expect(
      verifyNativeEmbeddingResources(new AbortController().signal, {
        developmentDirectory: directory,
      }),
    ).resolves.toEqual({ executable, buildIdentity: manifest.buildIdentity });
    const missing = manifest.files.find((file) => file.path !== manifest.executable);
    expect(missing).toBeDefined();
    await expect(verifyNativeArtifact(directory)).rejects.toMatchObject({
      file: missing!.path,
      check: "missing",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native preparation rejects an unusable, wrong-size or corrupt required executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-native-invalid-"));
  try {
    const { executable, manifest, artifact } = await nativeFixture(directory);
    const file = `native/${artifact.id}/${manifest.executable}`;
    if (process.platform !== "win32") {
      await chmod(executable, 0o644);
      await expect(
        verifyNativeEmbeddingResources(new AbortController().signal, {
          developmentDirectory: directory,
        }),
      ).rejects.toMatchObject({
        code: "embedding.native-resource-invalid",
        resource: { file, check: "invalid" },
      });
      await chmod(executable, 0o755);
    }
    await writeFile(executable, "short");
    await expect(
      verifyNativeEmbeddingResources(new AbortController().signal, {
        developmentDirectory: directory,
      }),
    ).rejects.toMatchObject({
      code: "embedding.native-resource-invalid",
      resource: { file, check: "size-mismatch" },
    });
    await writeFile(executable, "x".repeat(Buffer.byteLength("native fixture")));
    await expect(
      verifyNativeEmbeddingResources(new AbortController().signal, {
        developmentDirectory: directory,
      }),
    ).rejects.toMatchObject({
      code: "embedding.native-resource-invalid",
      resource: { file, check: "sha256-mismatch" },
    });
    await rm(executable);
    await expect(
      prepareEmbeddingResources(
        resolveEmbeddingConfig({ cacheDirectory: join(directory, "cache") }),
        new AbortController().signal,
        () => {},
        {
          developmentDirectory: directory,
          model: {
            download: async () => {
              throw new Error("missing executable must fail before transfer");
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "embedding.native-resource-invalid",
      resource: { file, check: "missing" },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preparation returns the promoted model together with its prepared native identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-prepared-resources-"));
  try {
    const { executable, manifest } = await nativeFixture(directory);
    const content = "model fixture";
    const artifact = {
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    const cacheDirectory = join(directory, "cache");
    const prepared = await prepareEmbeddingResources(
      resolveEmbeddingConfig({ cacheDirectory }),
      new AbortController().signal,
      () => {},
      {
        developmentDirectory: directory,
        model: {
          artifact,
          download: async (options) => {
            await writeFile(options.destination, content);
          },
        },
      },
    );
    expect(prepared).toEqual({
      modelPath: join(cacheDirectory, artifact.sha256, "model.gguf"),
      executable,
      buildIdentity: manifest.buildIdentity,
    });
    expect(await Bun.file(prepared.modelPath).text()).toBe(content);
    expect(await Bun.file(`${prepared.modelPath}.part`).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
