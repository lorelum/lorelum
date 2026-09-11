import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkDirectory,
  readRecord,
  removeRecord,
  writeRecord,
  type RuntimeRecord,
} from "./runtime-state";
import { processIdentity } from "./process-identity";
import { logEvent } from "./log";

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "backend-state-")));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function record(): Promise<RuntimeRecord> {
  return {
    ...(await processIdentity(process.pid))!,
    instanceId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    buildIdentity: "test",
    controlVersion: 1,
    businessVersion: 1,
  };
}
test("private state rejects malformed, permissive and redirected files", async () =>
  fixture(async (directory) => {
    const value = await record();
    await writeRecord(directory, value);
    expect(await readRecord(directory)).toEqual(value);
    await chmod(join(directory, "instance.json"), 0o644);
    await expect(readRecord(directory)).rejects.toMatchObject({ code: "backend.state-invalid" });
    await chmod(join(directory, "instance.json"), 0o600);
    await writeFile(join(directory, "instance.json"), "not json");
    await expect(readRecord(directory)).rejects.toMatchObject({ code: "backend.state-invalid" });
    await rm(join(directory, "instance.json"));
    await writeFile(join(directory, "elsewhere"), JSON.stringify(value), { mode: 0o600 });
    await symlink(join(directory, "elsewhere"), join(directory, "instance.json"));
    await expect(readRecord(directory)).rejects.toMatchObject({ code: "backend.state-invalid" });
  }));
test("cleanup cannot delete a replacement instance record", async () =>
  fixture(async (directory) => {
    const previous = await record();
    const replacement = await record();
    await writeRecord(directory, previous);
    await writeRecord(directory, replacement);
    await removeRecord(directory, previous.instanceId);
    expect((await readRecord(directory))?.instanceId).toBe(replacement.instanceId);
  }));

test("runtime records carry the optional embedding snapshot", async () =>
  fixture(async (directory) => {
    const value = { ...(await record()), embedding: { modelPath: "/models/granite.gguf" } };
    await writeRecord(directory, value);
    expect((await readRecord(directory))?.embedding).toMatchObject(value.embedding);
  }));

test("runtime record writes reject serialized records over 4096 UTF-8 bytes", async () =>
  fixture(async (directory) => {
    const value = { ...(await record()), embedding: { modelPath: `/${"模型".repeat(1_000)}` } };
    await expect(writeRecord(directory, value)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));

test("runtime record rejects embedding snapshots over 2048 UTF-8 bytes", async () =>
  fixture(async (directory) => {
    const value = { ...(await record()), embedding: { modelPath: `/${"模型".repeat(700)}` } };
    await expect(writeRecord(directory, value)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));
test("runtime directory permissions are checked without silently repairing them", async () =>
  fixture(async (directory) => {
    await chmod(directory, 0o755);
    await expect(checkDirectory(directory)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));
test("lifecycle log rotates at a bounded size", async () =>
  fixture(async (directory) => {
    await writeFile(join(directory, "backend.log"), "x".repeat(65_536), { mode: 0o600 });
    await logEvent(directory, "ready");
    const current = await readFile(join(directory, "backend.log"), "utf8");
    expect(JSON.parse(current).event).toBe("ready");
    expect((await readFile(join(directory, "backend.log.1"))).length).toBe(65_536);
  }));
