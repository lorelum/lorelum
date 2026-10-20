import { createLogRecord } from "@lorelum/log";
import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkDirectory,
  readRecord,
  removeRecord,
  runtimeRecordSchema,
  writeRecord,
  type RuntimeRecord,
} from "./runtime-state";
import { processIdentity } from "./process-identity";
import { createPrivateJsonlSink } from "./private-jsonl-sink";

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
    protocolVersion: 1,
  };
}
test("private state rejects malformed, permissive and redirected files", async () =>
  fixture(async (directory) => {
    const value = await record();
    await writeRecord(directory, value);
    expect(await readRecord(directory)).toEqual(value);
    const posix = process.platform !== "win32";
    if (posix) {
      await chmod(join(directory, "instance.json"), 0o644);
      await expect(readRecord(directory)).rejects.toMatchObject({
        code: "backend.state-invalid",
      });
      await chmod(join(directory, "instance.json"), 0o600);
    }
    await writeFile(join(directory, "instance.json"), "not json");
    await expect(readRecord(directory)).rejects.toMatchObject({ code: "backend.state-invalid" });
    if (posix) {
      await rm(join(directory, "instance.json"));
      await writeFile(join(directory, "elsewhere"), JSON.stringify(value), { mode: 0o600 });
      await symlink(join(directory, "elsewhere"), join(directory, "instance.json"));
      await expect(readRecord(directory)).rejects.toMatchObject({
        code: "backend.state-invalid",
      });
    }
  }));
test.skipIf(process.platform === "win32")(
  "runtime state accepts a linked ancestor but still rejects insecure credential leaves",
  async () =>
    fixture(async (directory) => {
      const parent = join(directory, "linked-parent");
      await symlink(directory, parent, "dir");
      const runtime = join(parent, "nested", "runtime");
      expect(await readRecord(runtime)).toBeUndefined();
      expect(await checkDirectory(runtime, true)).toBe(true);
      const value = await record();
      await writeRecord(runtime, value);
      expect(await readRecord(runtime)).toEqual(value);
      const credential = join(runtime, "instance.json");
      await chmod(credential, 0o644);
      await expect(readRecord(runtime)).rejects.toMatchObject({ code: "backend.state-invalid" });
      await chmod(credential, 0o600);
      await rm(credential);
      const target = join(directory, "redirected-credential");
      await writeFile(target, JSON.stringify(value), { mode: 0o600 });
      await symlink(target, credential);
      await expect(readRecord(runtime)).rejects.toMatchObject({ code: "backend.state-invalid" });
      const alias = join(directory, "runtime-alias");
      await symlink(runtime, alias, "dir");
      await expect(checkDirectory(alias, true)).rejects.toMatchObject({
        code: "backend.state-invalid",
      });
    }),
);

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
    const value = { ...(await record()), startedAt: "模型".repeat(1_000) };
    await expect(writeRecord(directory, value)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));

test("runtime record schema and writes enforce the exact UTF-8 size boundary", async () =>
  fixture(async (directory) => {
    const value = { ...(await record()), startedAt: "" };
    const remaining = 4_096 - Buffer.byteLength(JSON.stringify(value), "utf8");
    value.startedAt = `${"模".repeat(Math.floor(remaining / 3))}${"x".repeat(remaining % 3)}`;
    expect(runtimeRecordSchema.safeParse(value).success).toBe(true);
    await writeRecord(directory, value);
    expect(await readRecord(directory)).toEqual(value);
    const oversized = { ...value, startedAt: `${value.startedAt}x` };
    expect(runtimeRecordSchema.safeParse(oversized).success).toBe(false);
    await expect(writeRecord(directory, oversized)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
    expect(await readRecord(directory)).toEqual(value);
    await writeFile(join(directory, "instance.json"), JSON.stringify(oversized));
    await expect(readRecord(directory)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));

test("runtime updates reject partial embedding defaults that expand beyond the record limit", async () =>
  fixture(async (directory) => {
    const current = await record();
    await writeRecord(directory, current);
    const value = { ...current, startedAt: "", embedding: { modelPath: "/models/test.gguf" } };
    value.startedAt = "x".repeat(4_096 - Buffer.byteLength(JSON.stringify(value), "utf8"));
    expect(runtimeRecordSchema.safeParse(value).success).toBe(false);
    await expect(writeRecord(directory, value)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
    expect(await readRecord(directory)).toEqual(current);
  }));

test.each([{ pid: 0 }, { secret: "invalid" }, { unknownField: true }])(
  "invalid runtime update %j preserves the existing private record",
  async (invalid) =>
    fixture(async (directory) => {
      const current = await record();
      await writeRecord(directory, current);
      await expect(writeRecord(directory, { ...current, ...invalid })).rejects.toMatchObject({
        code: "backend.state-invalid",
      });
      expect(await readRecord(directory)).toEqual(current);
    }),
);

test("runtime reads reject structurally invalid JSON records", async () =>
  fixture(async (directory) => {
    const value = { ...(await record()), pid: 0 };
    await writeFile(join(directory, "instance.json"), JSON.stringify(value), { mode: 0o600 });
    await expect(readRecord(directory)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));

test("runtime updates leave the current record intact when the temporary file exists", async () =>
  fixture(async (directory) => {
    const current = await record();
    const replacement = await record();
    await writeRecord(directory, current);
    const temporary = join(directory, `${replacement.instanceId}.tmp`);
    await writeFile(temporary, "occupied", { mode: 0o600 });
    await expect(writeRecord(directory, replacement)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readRecord(directory)).toEqual(current);
    expect(await readFile(temporary, "utf8")).toBe("occupied");
  }));

test("runtime record rejects embedding snapshots over 2048 UTF-8 bytes", async () =>
  fixture(async (directory) => {
    const value = { ...(await record()), embedding: { modelPath: `/${"模型".repeat(700)}` } };
    await expect(writeRecord(directory, value)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));
test.skipIf(process.platform === "win32")(
  "runtime directory permissions are checked without silently repairing them",
  async () =>
    fixture(async (directory) => {
      await chmod(directory, 0o755);
      await expect(checkDirectory(directory)).rejects.toMatchObject({
        code: "backend.state-invalid",
      });
    }),
);
test("private state rejects a hard-linked instance record", async () =>
  fixture(async (directory) => {
    const value = await record();
    await writeRecord(directory, value);
    await link(join(directory, "instance.json"), join(directory, "alias.json"));
    await expect(readRecord(directory)).rejects.toMatchObject({
      code: "backend.state-invalid",
    });
  }));
test("private diagnostic lifecycle log rotates at a bounded size", async () =>
  fixture(async (directory) => {
    await writeFile(join(directory, "backend.log"), "x".repeat(65_536), { mode: 0o600 });
    const sink = await createPrivateJsonlSink({ directory });
    await sink.write(
      createLogRecord({
        time: new Date().toISOString(),
        level: "info",
        component: "backend",
        event: "backend.daemon.ready",
      }),
    );
    await sink.close();
    const current = await readFile(join(directory, "backend.log"), "utf8");
    expect(JSON.parse(current).message).toBe("backend.daemon.ready");
    expect((await readFile(join(directory, "backend.log.1"))).length).toBe(65_536);
  }));
