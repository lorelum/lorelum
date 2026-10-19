import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
  readFile,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEmbeddingConfig } from "../config/embedding";
import { DownloadError } from "../download/file";
import { prepareModel } from "./prepare";

const content = "model fixture";
const artifact = {
  bytes: Buffer.byteLength(content),
  sha256: createHash("sha256").update(content).digest("hex"),
};
async function fixture(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lore-model-cache-")));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("preparation preserves interrupted data, atomically promotes verified bytes, then reuses cache", () =>
  fixture(async (root) => {
    const config = resolveEmbeddingConfig({
      cacheDirectory: root,
      download: { url: "https://example.test/fixed.gguf" },
    });
    const partial = join(root, artifact.sha256, "model.gguf.part");
    await expect(
      prepareModel(config, new AbortController().signal, () => {}, {
        artifact,
        download: async (options) => {
          await writeFile(options.destination, "model");
          throw new DownloadError("network");
        },
      }),
    ).rejects.toMatchObject({ code: "embedding.download-failed" });
    expect(await readFile(partial, "utf8")).toBe("model");
    const phases: string[] = [];
    const result = await prepareModel(
      config,
      new AbortController().signal,
      (p) => phases.push(p.phase),
      {
        artifact,
        download: async (options) => {
          expect(await readFile(options.destination, "utf8")).toBe("model");
          await writeFile(options.destination, content);
          options.onProgress({
            downloadedBytes: artifact.bytes,
            totalBytes: artifact.bytes,
            attempt: 1,
          });
        },
      },
    );
    expect(await readFile(result, "utf8")).toBe(content);
    await expect(stat(partial)).rejects.toMatchObject({ code: "ENOENT" });
    expect(phases).toEqual(["downloading", "verifying"]);
    expect(
      await prepareModel(config, new AbortController().signal, () => {}, {
        artifact,
        download: async () => {
          throw new Error("verified cache must not download");
        },
      }),
    ).toBe(result);
  }));

test("bad checksum is never promoted or silently erased", () =>
  fixture(async (root) => {
    const config = resolveEmbeddingConfig({
      cacheDirectory: root,
      download: { url: "https://example.test/model" },
    });
    await expect(
      prepareModel(config, new AbortController().signal, () => {}, {
        artifact,
        download: async (options) => {
          await writeFile(options.destination, "x".repeat(artifact.bytes));
        },
      }),
    ).rejects.toMatchObject({
      code: "embedding.resource-invalid",
      resource: {
        kind: "model",
        file: "model.gguf.part",
        check: "sha256-mismatch",
        expected: artifact.sha256,
        actual: createHash("sha256").update("x".repeat(artifact.bytes)).digest("hex"),
      },
    });
    expect((await stat(join(root, artifact.sha256, "model.gguf.part"))).size).toBe(artifact.bytes);
    await expect(stat(join(root, artifact.sha256, "model.gguf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }));

test("explicit files and disabled downloads never trigger a transfer", () =>
  fixture(async (root) => {
    const deps = {
      artifact,
      download: async () => {
        throw new Error("unexpected network access");
      },
    };
    for (const [value, code] of [
      [{ cacheDirectory: root, download: { enabled: false } }, "embedding.not-configured"],
      [{ modelPath: join(root, "missing") }, "embedding.resource-invalid"],
    ] as const)
      // eslint-disable-next-line no-await-in-loop
      await expect(
        prepareModel(resolveEmbeddingConfig(value), new AbortController().signal, () => {}, deps),
      ).rejects.toMatchObject({ code });
    const path = join(root, "explicit.gguf");
    await writeFile(path, content);
    expect(
      await prepareModel(
        resolveEmbeddingConfig({ modelPath: path }),
        new AbortController().signal,
        () => {},
        deps,
      ),
    ).toBe(path);
  }));

test("two preparers cannot write the same partial file concurrently", () =>
  fixture(async (root) => {
    const config = resolveEmbeddingConfig({
      cacheDirectory: root,
      download: { url: "https://example.test/model" },
    });
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = prepareModel(config, new AbortController().signal, () => {}, {
      artifact,
      download: async (options) => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await writeFile(options.destination, content);
      },
    });
    await ready;
    try {
      await expect(
        prepareModel(config, new AbortController().signal, () => {}, { artifact }),
      ).rejects.toMatchObject({ code: "embedding.busy" });
    } finally {
      release();
      await first;
    }
  }));

test("missing source configuration downloads the fixed model from the default URL", () =>
  fixture(async (root) => {
    const config = resolveEmbeddingConfig({ cacheDirectory: root });
    let requestedUrl: string | undefined;
    const path = await prepareModel(config, new AbortController().signal, () => {}, {
      artifact,
      download: async (options) => {
        requestedUrl = options.url;
        await writeFile(options.destination, content);
      },
    });
    expect(requestedUrl).toBe(config.download.url);
    expect(requestedUrl).toContain("huggingface.co/Lorelum/");
    expect(path).toBe(join(root, artifact.sha256, "model.gguf"));
  }));

test("public explicit and cached models accept readable hardlinks without private file modes", () =>
  fixture(async (root) => {
    const source = join(root, "public.gguf");
    await writeFile(source, content, { mode: 0o644 });
    await chmod(source, 0o644);
    const explicit = join(root, "explicit.gguf");
    await link(source, explicit);
    const directory = join(root, artifact.sha256);
    await mkdir(directory, { mode: 0o755 });
    const cached = join(directory, "model.gguf");
    await link(source, cached);
    const deps = {
      artifact,
      download: async () => {
        throw new Error("a readable model must not download");
      },
    };
    await expect(
      prepareModel(
        resolveEmbeddingConfig({ modelPath: explicit }),
        new AbortController().signal,
        () => {},
        deps,
      ),
    ).resolves.toBe(explicit);
    await expect(
      prepareModel(
        resolveEmbeddingConfig({ cacheDirectory: root }),
        new AbortController().signal,
        () => {},
        deps,
      ),
    ).resolves.toBe(cached);
  }));

test("readable model symlinks are verified as ordinary files", () =>
  fixture(async (root) => {
    const source = join(root, "source.gguf");
    const path = join(root, "linked.gguf");
    await writeFile(source, content);
    try {
      await symlink(source, path);
    } catch (error) {
      if (
        process.platform === "win32" &&
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      )
        return;
      throw error;
    }
    const config = resolveEmbeddingConfig({ modelPath: path });
    await expect(
      prepareModel(config, new AbortController().signal, () => {}, { artifact }),
    ).resolves.toBe(path);
    const directory = join(root, artifact.sha256);
    await mkdir(directory);
    const cached = join(directory, "model.gguf");
    await symlink(source, cached);
    await expect(
      prepareModel(
        resolveEmbeddingConfig({ cacheDirectory: root }),
        new AbortController().signal,
        () => {},
        { artifact },
      ),
    ).resolves.toBe(cached);
    await writeFile(source, "incomplete");
    await expect(
      prepareModel(config, new AbortController().signal, () => {}, { artifact }),
    ).rejects.toMatchObject({
      code: "embedding.resource-invalid",
      resource: { kind: "model", file: "embedding.modelPath", check: "size-mismatch" },
    });
  }));

test("cancelling a transfer preserves its partial bytes without publishing a model", () =>
  fixture(async (root) => {
    const config = resolveEmbeddingConfig({ cacheDirectory: root });
    const controller = new AbortController();
    await expect(
      prepareModel(config, controller.signal, () => {}, {
        artifact,
        download: async (options) => {
          await writeFile(options.destination, "model");
          controller.abort();
        },
      }),
    ).rejects.toThrow();
    const destination = join(root, artifact.sha256, "model.gguf");
    expect(await readFile(`${destination}.part`, "utf8")).toBe("model");
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  }));

test("partial download hardlinks cannot overwrite a public model", () =>
  fixture(async (root) => {
    const source = join(root, "public.gguf");
    await writeFile(source, "model", { mode: 0o600 });
    const directory = join(root, artifact.sha256);
    await mkdir(directory, { mode: 0o700 });
    const partial = join(directory, "model.gguf.part");
    await link(source, partial);
    await expect(
      prepareModel(
        resolveEmbeddingConfig({ cacheDirectory: root }),
        new AbortController().signal,
        () => {},
        {
          artifact,
          download: async () => {
            throw new Error("unsafe partial must never be written");
          },
        },
      ),
    ).rejects.toMatchObject({ code: "backend.state-invalid" });
    expect(await readFile(source, "utf8")).toBe("model");
    expect(await readFile(partial, "utf8")).toBe("model");
  }));
