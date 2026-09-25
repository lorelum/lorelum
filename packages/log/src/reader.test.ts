/* eslint-disable no-await-in-loop -- Test fixtures set both roots up in a fixed order. */
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogRecord } from "./record.js";
import { pruneManagedLogs, readManagedLogs } from "./reader.js";

test("reads only managed JSONL records and filters one trace", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-log-reader-"));
  try {
    const directory = join(root, "cli", "2026-09-18");
    await mkdir(directory, { recursive: true });
    const one = createLogRecord({
      level: "info",
      source: "cli.query",
      message: "completed",
      traceId: "00000000-0000-4000-8000-000000000101" as never,
      query: "one",
    });
    const two = createLogRecord({
      level: "debug",
      source: "cli.query",
      message: "completed",
      traceId: "00000000-0000-4000-8000-000000000102" as never,
      query: "two",
    });
    await writeFile(
      join(directory, "first.jsonl"),
      `${JSON.stringify(one)}\n${JSON.stringify(two)}\n`,
    );
    const result = await readManagedLogs({
      rootDirectory: root,
      traceId: one.traceId!,
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.context).toMatchObject({ query: "one" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prunes only expired managed JSONL files", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-log-prune-"));
  try {
    await mkdir(join(root, "cli"));
    const old = join(root, "cli", "old.jsonl");
    const current = join(root, "cli", "current.jsonl");
    await writeFile(old, "{}\n");
    await writeFile(current, "{}\n");
    const result = await pruneManagedLogs({
      rootDirectory: root,
      now: Date.now() + 2 * 86_400_000,
      maxAgeDays: 1,
    });
    expect(result.deletedFiles).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads records from both designed roots with location labels", async () => {
  const primary = await mkdtemp(join(tmpdir(), "lorelum-log-primary-"));
  const fallback = await mkdtemp(join(tmpdir(), "lorelum-log-fallback-"));
  try {
    await mkdir(join(primary, "cli"), { recursive: true });
    await mkdir(join(fallback, "cli"), { recursive: true });
    const one = createLogRecord({
      level: "info",
      source: "cli.query",
      message: "completed",
      traceId: "00000000-0000-4000-8000-000000000201" as never,
    });
    const two = createLogRecord({
      level: "info",
      source: "cli.query",
      message: "completed",
      traceId: "00000000-0000-4000-8000-000000000202" as never,
    });
    await writeFile(join(primary, "cli", "one.jsonl"), `${JSON.stringify(one)}\n`);
    await writeFile(join(fallback, "cli", "two.jsonl"), `${JSON.stringify(two)}\n`);

    const result = await readManagedLogs({
      rootDirectory: primary,
      fallbackRootDirectory: fallback,
    });
    expect(result.records).toHaveLength(2);
    expect(result.locations).toEqual(["primary", "fallback"]);
    expect(result.rootAvailability).toEqual([
      { root: "primary", state: "available" },
      { root: "fallback", state: "available" },
    ]);
  } finally {
    await rm(primary, { recursive: true, force: true });
    await rm(fallback, { recursive: true, force: true });
  }
});

test("a missing fallback root is not missing evidence when the primary has records", async () => {
  const primary = await mkdtemp(join(tmpdir(), "lorelum-log-primary-"));
  try {
    await mkdir(join(primary, "cli"), { recursive: true });
    const one = createLogRecord({
      level: "info",
      source: "cli.query",
      message: "completed",
      traceId: "00000000-0000-4000-8000-000000000203" as never,
    });
    await writeFile(join(primary, "cli", "one.jsonl"), `${JSON.stringify(one)}\n`);

    const result = await readManagedLogs({
      rootDirectory: primary,
      fallbackRootDirectory: join(primary, "fallback-absent"),
    });
    expect(result.records).toHaveLength(1);
    expect(result.missing).toEqual([]);
    expect(result.rootAvailability[1]).toEqual({ root: "fallback", state: "missing" });
  } finally {
    await rm(primary, { recursive: true, force: true });
  }
});

test("keeps the historical empty-store marker when both roots hold no files", async () => {
  const primary = await mkdtemp(join(tmpdir(), "lorelum-log-primary-"));
  try {
    const result = await readManagedLogs({
      rootDirectory: primary,
      fallbackRootDirectory: join(primary, "fallback-absent"),
    });
    expect(result.records).toEqual([]);
    expect(result.missing).toEqual(["log-files-missing"]);
  } finally {
    await rm(primary, { recursive: true, force: true });
  }
});

test("prunes the fallback root under the same rules", async () => {
  const primary = await mkdtemp(join(tmpdir(), "lorelum-log-primary-"));
  const fallback = await mkdtemp(join(tmpdir(), "lorelum-log-fallback-"));
  try {
    for (const root of [primary, fallback]) {
      await mkdir(join(root, "cli"));
      await writeFile(join(root, "cli", "old.jsonl"), "{}\n");
      await writeFile(join(root, "cli", "current.jsonl"), "{}\n");
      await writeFile(join(root, "unmanaged.txt"), "keep\n");
    }
    const result = await pruneManagedLogs({
      rootDirectory: primary,
      fallbackRootDirectory: fallback,
      now: Date.now() + 2 * 86_400_000,
      maxAgeDays: 1,
    });
    expect(result.deletedFiles).toBe(4);
  } finally {
    await rm(primary, { recursive: true, force: true });
    await rm(fallback, { recursive: true, force: true });
  }
});
