import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigError,
  DEFAULT_LOGGING_SETTINGS,
  loadLoggingSettings,
  loggingLevels,
  resolveLoggingSettings,
} from "./index.js";

test("uses info logging by default and reads the consumer-owned logging section", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    expect(await loadLoggingSettings({ homeDirectory: home })).toEqual(DEFAULT_LOGGING_SETTINGS);
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "logging:\n  level: debug\n");
    await expect(loadLoggingSettings({ homeDirectory: home })).resolves.toEqual({ level: "debug" });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects an invalid logging level", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "logging:\n  level: noisy\n");
    await expect(loadLoggingSettings({ homeDirectory: home })).rejects.toEqual(new ConfigError());
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("resolves a missing logging level to the default without reporting invalid facts", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "query:\n  maxWaitMs: 1000\n");
    expect(await resolveLoggingSettings({ homeDirectory: home })).toEqual({
      status: "valid",
      level: "info",
    });
    await writeFile(join(home, ".lorelum", "config.yaml"), "logging: {}\n");
    expect(await resolveLoggingSettings({ homeDirectory: home })).toEqual({
      status: "valid",
      level: "info",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("resolves a valid logging level", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "logging:\n  level: warn\n");
    expect(await resolveLoggingSettings({ homeDirectory: home })).toEqual({
      status: "valid",
      level: "warn",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("reports structured invalid facts for a rejected logging level", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "logging:\n  level: noisy\n");
    expect(await resolveLoggingSettings({ homeDirectory: home })).toEqual({
      status: "invalid",
      received: "noisy",
      allowedValues: loggingLevels,
      source: join(home, ".lorelum", "config.yaml"),
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("reports the canonical string form of a non-string logging level", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "logging:\n  level: 3\n");
    expect(await resolveLoggingSettings({ homeDirectory: home })).toEqual({
      status: "invalid",
      received: "3",
      allowedValues: loggingLevels,
      source: join(home, ".lorelum", "config.yaml"),
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("keeps throwing on an unreadable configuration document", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-logging-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "logging: [unclosed\n");
    await expect(resolveLoggingSettings({ homeDirectory: home })).rejects.toEqual(
      new ConfigError(),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
