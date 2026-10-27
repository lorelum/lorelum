import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigError,
  DEFAULT_LOGGING_SETTINGS,
  loadLoggingSettings,
  resolveLoggingSettings,
} from "./index.js";

async function withConfig(run: (homeDirectory: string, filePath: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    await run(home, join(home, ".lorelum", "config.yaml"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("uses info for missing, empty, and empty logging sections without a fallback", async () => {
  await withConfig(async (homeDirectory, filePath) => {
    expect(await resolveLoggingSettings({ homeDirectory })).toEqual({
      kind: "configured",
      persistentLevel: "info",
      effectiveLevel: "info",
    });

    await mkdir(join(homeDirectory, ".lorelum"));
    await writeFile(filePath, "logging: {}\n");
    const before = await readFile(filePath);
    expect(await loadLoggingSettings({ filePath })).toEqual(DEFAULT_LOGGING_SETTINGS);
    expect(await resolveLoggingSettings({ filePath })).toEqual({
      kind: "configured",
      persistentLevel: "info",
      effectiveLevel: "info",
    });
    expect(await readFile(filePath)).toEqual(before);
  });
});

test("keeps the configured persistent level and applies invocation debug separately", async () => {
  await withConfig(async (homeDirectory, filePath) => {
    await mkdir(join(homeDirectory, ".lorelum"));
    await writeFile(filePath, "logging:\n  level: warn\n");
    expect(await resolveLoggingSettings({ filePath, debug: true })).toEqual({
      kind: "configured",
      persistentLevel: "warn",
      effectiveLevel: "debug",
    });
  });
});

for (const [document, expected] of [
  [{ logging: "secret" }, { subject: "logging", reason: "type", receivedType: "string" }],
  [{ logging: { level: 3 } }, { subject: "logging.level", reason: "type", receivedType: "number" }],
  [
    { logging: { level: "noisy" } },
    { subject: "logging.level", reason: "enum", receivedType: "string" },
  ],
] as const) {
  test(`falls back for invalid ${expected.subject} with typed facts`, async () => {
    const filePath = "/tmp/lorelum-config.yaml";
    const resolution = await resolveLoggingSettings({
      filePath,
      readConfig: async () => document,
    });
    expect(resolution.kind).toBe("fallback");
    if (resolution.kind !== "fallback" || resolution.cause.kind !== "config")
      throw new Error("expected a classified logging fallback");
    expect(resolution.fallbackLevel).toBe("info");
    expect(resolution.effectiveLevel).toBe("info");
    expect(resolution.cause.error.failure).toMatchObject({
      kind: "setting",
      source: { kind: "file", path: filePath },
      subject: expected.subject,
      reason: expected.reason,
      receivedType: expected.receivedType,
    });
  });
}

test("strict logging loader preserves the classified ConfigError", async () => {
  const error = await loadLoggingSettings(
    {
      filePath: "/tmp/lorelum-config.yaml",
    },
    async () => ({ logging: { level: "noisy" } }),
  ).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConfigError);
  if (!(error instanceof ConfigError)) throw error;
  expect(error.failure).toMatchObject({
    kind: "setting",
    subject: "logging.level",
    reason: "enum",
  });
});

test("invalid logging values report allowed levels without copying credentials", async () => {
  for (const level of [3, "https://alice:sensitive-password@example.com"]) {
    const resolution = await resolveLoggingSettings({
      readConfig: async () => ({ logging: { level } }),
    });
    if (resolution.kind !== "fallback" || resolution.cause.kind !== "config")
      throw new Error("expected a classified logging fallback");
    const { error } = resolution.cause;
    expect(error.message).toContain('one of "error", "warn", "info", "debug"');
    expect(error.message).not.toContain("sensitive-password");
    expect(JSON.stringify(error.failure)).not.toContain("sensitive-password");
  }
});

test("malformed YAML uses a document failure and does not modify the config", async () => {
  await withConfig(async (homeDirectory, filePath) => {
    await mkdir(join(homeDirectory, ".lorelum"));
    await writeFile(filePath, "private-token: [secret");
    const before = await readFile(filePath);
    const resolution = await resolveLoggingSettings({ filePath });
    expect(resolution.kind).toBe("fallback");
    if (resolution.kind !== "fallback" || resolution.cause.kind !== "config")
      throw new Error("expected a classified logging fallback");
    expect(resolution.cause.error.failure).toMatchObject({
      kind: "document",
      reason: "yaml-syntax",
      source: { kind: "file", path: filePath },
      location: { line: 2, column: 1 },
    });
    expect(resolution.cause.error.message).not.toContain("private-token");
    expect(resolution.cause.error.message).not.toContain("secret");
    expect(await readFile(filePath)).toEqual(before);
  });
});

test("a known read failure is reported as a document ConfigError", async () => {
  await withConfig(async (homeDirectory) => {
    const parent = join(homeDirectory, "not-a-directory");
    await writeFile(parent, "private");
    const resolution = await resolveLoggingSettings({ filePath: join(parent, "config.yaml") });
    expect(resolution.kind).toBe("fallback");
    if (resolution.kind !== "fallback" || resolution.cause.kind !== "config")
      throw new Error("expected a classified logging fallback");
    expect(resolution.cause.error.failure).toMatchObject({
      kind: "document",
      reason: "unreadable",
      source: { kind: "file", path: join(parent, "config.yaml") },
    });
  });
});

test("unknown logging reader failures keep the fail-open result without invented facts", async () => {
  const resolution = await resolveLoggingSettings({
    debug: true,
    readConfig: async () => {
      throw new TypeError("private implementation detail");
    },
  });
  expect(resolution).toEqual({
    kind: "fallback",
    fallbackLevel: "info",
    effectiveLevel: "debug",
    cause: { kind: "unavailable" },
  });
  if (resolution.kind !== "fallback") throw new Error("expected a logging fallback");
  expect("error" in resolution.cause).toBe(false);
});
