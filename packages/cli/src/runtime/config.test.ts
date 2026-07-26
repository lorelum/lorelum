import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, resolveConfigPath, type ConfigFileSystem } from "./config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("resolves explicit config ahead of environment and default paths", () => {
  const resolved = resolveConfigPath({
    env: { LORELUM_CONFIG: "/environment/config.json" },
    explicitPath: "/explicit/config.json",
    homeDirectory: "/home/agent",
    platform: "linux",
  });

  expect(resolved).toEqual({ path: "/explicit/config.json", source: "explicit" });
});

test("rejects relative explicit, environment, and platform config directories", () => {
  const cases = [
    { explicitPath: "config.json" },
    { env: { LORELUM_CONFIG: "config.json" } },
    { env: { XDG_CONFIG_HOME: "config" } },
  ];

  for (const options of cases) {
    try {
      resolveConfigPath({ ...options, platform: "linux" });
      throw new Error("Expected relative configuration path to be rejected.");
    } catch (error) {
      expect(error).toMatchObject({ code: "config.path_invalid" });
    }
  }
});

test("uses XDG configuration paths without consulting the working directory", () => {
  expect(
    resolveConfigPath({
      env: { XDG_CONFIG_HOME: "/home/agent/.lore-config" },
      homeDirectory: "/home/agent",
      platform: "linux",
    }),
  ).toEqual({ path: "/home/agent/.lore-config/lorelum/config.json", source: "default" });
});

test("uses APPDATA for the Windows default path", () => {
  expect(
    resolveConfigPath({
      env: { APPDATA: "C:\\Users\\agent\\AppData\\Roaming" },
      homeDirectory: "C:\\Users\\agent",
      platform: "win32",
    }),
  ).toEqual({
    path: "C:\\Users\\agent\\AppData\\Roaming\\Lorelum\\config.json",
    source: "default",
  });
});

test("uses built-in defaults only when the default path is absent", async () => {
  const directory = await createTemporaryDirectory();
  const missing = join(directory, "missing.json");

  expect(await loadConfig(missing, false)).toEqual({
    configuration: { version: 1 },
    source: "default",
  });
  await expect(loadConfig(missing, true)).rejects.toMatchObject({ code: "config.unreadable" });
});

test("rejects invalid configuration files without exposing their contents", async () => {
  const directory = await createTemporaryDirectory();
  const invalidJson = join(directory, "invalid.json");
  const unknownField = join(directory, "unknown.json");
  const oversized = join(directory, "oversized.json");
  await writeFile(invalidJson, "not json");
  await writeFile(unknownField, '{"version":1,"endpoint":"https://secret.example"}');
  await writeFile(oversized, "x".repeat(64 * 1024 + 1));

  await expect(loadConfig(invalidJson, true)).rejects.toMatchObject({
    code: "config.invalid_json",
  });
  await expect(loadConfig(unknownField, true)).rejects.toMatchObject({
    code: "config.unknown_field",
  });
  await expect(loadConfig(oversized, true)).rejects.toMatchObject({ code: "config.too_large" });
});

test("uses an injected filesystem context for deterministic configuration reads", async () => {
  const fileSystem = memoryFileSystem('{"version":1}');

  await expect(loadConfig("/controlled/config.json", true, fileSystem)).resolves.toEqual({
    configuration: { version: 1 },
    source: "file",
  });
});

test("rejects content that grows beyond the size limit after metadata validation", async () => {
  const fileSystem = memoryFileSystem('{"version":1}', "x".repeat(64 * 1024 + 1));

  await expect(loadConfig("/controlled/config.json", true, fileSystem)).rejects.toMatchObject({
    code: "config.too_large",
  });
});

if (process.platform !== "win32") {
  test("rejects symbolic links", async () => {
    const directory = await createTemporaryDirectory();
    const target = join(directory, "target.json");
    const link = join(directory, "config.json");
    await writeFile(target, '{"version":1}');
    await symlink(target, link);

    await expect(loadConfig(link, true)).rejects.toMatchObject({ code: "config.unreadable" });
  });
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

function memoryFileSystem(
  metadataContent: string,
  readContent: string = metadataContent,
): ConfigFileSystem {
  const metadata = {
    identity: "memory:1",
    kind: "file" as const,
    size: Buffer.byteLength(metadataContent),
  };
  return {
    async lstat() {
      return metadata;
    },
    async openReadOnly() {
      return {
        async close() {},
        async read() {
          return readContent;
        },
        async stat() {
          return metadata;
        },
      };
    },
  };
}
