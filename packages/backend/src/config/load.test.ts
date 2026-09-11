import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBackendConfig, resolveBackendSettings } from "./load";
import { DEFAULT_BACKEND_SETTINGS } from "./model";

async function fixture(run: (homeDirectory: string, filePath: string) => Promise<void>) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "lorelum-config-")));
  try {
    await run(home, join(home, "config.yaml"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("absent config uses defaults without creating files", () =>
  fixture(async (homeDirectory) => {
    const config = await loadBackendConfig({ homeDirectory, environment: {} });
    expect(config.settings).toEqual(DEFAULT_BACKEND_SETTINGS);
    expect(config.runtimeDirectory).toBe(join(homeDirectory, ".lorelum/run/backend"));
    expect(await readdir(homeDirectory)).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.settings)).toBe(true);
  }));

test("loads and freezes the optional embedding snapshot from shared config", () =>
  fixture(async (homeDirectory, filePath) => {
    await writeFile(filePath, "embedding:\n  modelPath: /models/granite.gguf\n");
    const config = await loadBackendConfig({ homeDirectory, filePath, environment: {} });
    expect(config.embedding).toMatchObject({ modelPath: "/models/granite.gguf" });
    expect(Object.isFrozen(config.embedding)).toBe(true);
  }));

test("rejects invalid embedding config", () =>
  fixture(async (homeDirectory, filePath) => {
    await writeFile(filePath, "embedding:\n  modelPath: relative.gguf\n");
    await expect(
      loadBackendConfig({ homeDirectory, filePath, environment: {} }),
    ).rejects.toMatchObject({ code: "backend.config-invalid" });
  }));

test("file, environment and explicit values override defaults in order", () =>
  fixture(async (homeDirectory, filePath) => {
    await writeFile(filePath, "backend:\n  startupTimeoutMs: 2000\n  requestTimeoutMs: 3000\n");
    const options = {
      homeDirectory,
      filePath,
      environment: { LORELUM_BACKEND_REQUEST_TIMEOUT_MS: "4000" },
    };
    const config = await loadBackendConfig({ ...options, overrides: { shutdownTimeoutMs: 6000 } });
    expect(config.settings).toEqual({
      startupTimeoutMs: 2000,
      requestTimeoutMs: 4000,
      shutdownTimeoutMs: 6000,
    });
    await writeFile(filePath, "backend:\n  startupTimeoutMs: 9000\n");
    expect(config.settings.startupTimeoutMs).toBe(2000);
    expect((await loadBackendConfig(options)).settings.startupTimeoutMs).toBe(9000);
  }));

test("invalid sources are rejected even when later sources override them", () => {
  expect(() =>
    resolveBackendSettings({ requestTimeoutMs: -1 }, { requestTimeoutMs: 1000 }),
  ).toThrow("The local backend configuration is invalid.");
});

for (const content of [
  "null",
  "{",
  '{"backend":{"port":26186}}',
  '{"backend":{"requestTimeoutMs":0}}',
  '{"backend":{"requestTimeoutMs":1.5}}',
  '{"backend":{"shutdownTimeoutMs":120001}}',
  " ".repeat(16385),
]) {
  test(
    "invalid config file is rejected without exposing its contents: " + content.slice(0, 30),
    () =>
      fixture(async (homeDirectory, filePath) => {
        await writeFile(filePath, content);
        await expect(
          loadBackendConfig({
            homeDirectory,
            filePath,
            environment: {},
            overrides: { requestTimeoutMs: 1000 },
          }),
        ).rejects.toMatchObject({ code: "backend.config-invalid" });
      }),
  );
}
for (const value of ["", "-1", "1.5", "Infinity", "120001", " 1000"]) {
  test("invalid environment timeout: " + value, () =>
    fixture(async (homeDirectory) => {
      await expect(
        loadBackendConfig({
          homeDirectory,
          environment: { LORELUM_BACKEND_REQUEST_TIMEOUT_MS: value },
        }),
      ).rejects.toMatchObject({ code: "backend.config-invalid" });
    }),
  );
}

test("explicit undefined cannot erase a required resolved setting", () => {
  expect(() => resolveBackendSettings({ requestTimeoutMs: undefined })).toThrow();
});

test("backend reads only its section from shared config", () =>
  fixture(async (homeDirectory, filePath) => {
    await writeFile(filePath, "backend:\n  requestTimeoutMs: 2000\nquery:\n  profile: local\n");
    expect(
      (await loadBackendConfig({ homeDirectory, filePath, environment: {} })).settings
        .requestTimeoutMs,
    ).toBe(2000);
    await writeFile(filePath, "query:\n  profile: local\n");
    expect(
      (await loadBackendConfig({ homeDirectory, filePath, environment: {} })).settings,
    ).toEqual(DEFAULT_BACKEND_SETTINGS);
    await writeFile(filePath, "backend: null\n");
    await expect(
      loadBackendConfig({ homeDirectory, filePath, environment: {} }),
    ).rejects.toMatchObject({ code: "backend.config-invalid" });
  }));
