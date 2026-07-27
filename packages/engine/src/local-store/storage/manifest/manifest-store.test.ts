import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyManifest, parseManifest, readManifest, writeManifest } from "./manifest-store";

test("manifest atomically round-trips its authoritative tuple", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-manifest-"));
  try {
    const manifest = {
      ...createEmptyManifest(),
      generation: 2,
      effectiveRevision: 5,
      packs: [
        {
          packName: "platform",
          packVersion: "1.0.0",
          artifactDigest: "a".repeat(64),
          storageKey: "p-platform",
          installedAt: "2026-07-27T00:00:00.000Z",
        },
      ],
    };
    await writeManifest(root, manifest);
    expect(await readManifest(root)).toEqual(manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest rejects unstable or unsafe Pack entries", () => {
  expect(() =>
    parseManifest(
      '{"schemaVersion":1,"generation":0,"effectiveRevision":0,"packs":[{"packName":"con","packVersion":"1.0.0","artifactDigest":"' +
        "a".repeat(64) +
        '","storageKey":"con","installedAt":"2026-07-27T00:00:00.000Z"}]}',
      "manifest",
    ),
  ).toThrow("invalid Pack entry");
});

test("manifest rejects a path-like Pack name before it reaches filesystem code", () => {
  expect(() =>
    parseManifest(
      '{"schemaVersion":1,"generation":0,"effectiveRevision":0,"packs":[{"packName":"../../escape","packVersion":"1.0.0","artifactDigest":"' +
        "a".repeat(64) +
        '","storageKey":"p-../../escape","installedAt":"2026-07-27T00:00:00.000Z"}]}',
      "manifest",
    ),
  ).toThrow("invalid Pack entry");
});
