import { expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  unlink,
  link,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { TraceId } from "@lorelum/log";

import { createProcessLogRuntime } from "./runtime.js";

const stderr = { write: (): void => undefined };

function trace(value: string): TraceId {
  return value as never;
}

function daySegment(): string {
  return new Date().toISOString().slice(0, 10);
}

async function withHome(
  run: (home: string, root: string, fallback: string) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "lorelum-runtime-"));
  const root = join(home, ".lorelum", "logs");
  const fallback = join(home, ".lorelum-diagnostics");
  try {
    await run(home, root, fallback);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function managedFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
    }
  }
  await visit(root);
  return found;
}

async function readSegment(root: string, traceId: TraceId): Promise<string> {
  const path = join(root, "cli", daySegment(), `${traceId}.jsonl`);
  return await Bun.file(path).text();
}

test.skipIf(process.platform === "win32")(
  "quiet normal path: writes to the primary root and reports no persistence deviation",
  async () =>
    withHome(async (home, root, fallback) => {
      const traceId = trace("00000000-0000-4000-8000-000000000401");
      const runtime = await createProcessLogRuntime(stderr, traceId, {
        debug: false,
        rootDirectory: root,
        fallbackRootDirectory: fallback,
      });
      runtime.log.info("command.started", { invocationId: "one" });
      await runtime.flush();
      expect(runtime.persistenceOutcome()).toBeUndefined();
      const text = await readSegment(root, traceId);
      expect(text).toContain("command.started");
      expect(text).not.toContain("log.persistence");
      expect(await managedFiles(fallback)).toEqual([]);
    }),
);

test.skipIf(process.platform === "win32")(
  "0755 primary chain is tightened, kept, and the repair is persisted as an outcome record",
  async () =>
    withHome(async (home, root, fallback) => {
      const lorelum = join(home, ".lorelum");
      await mkdir(join(root, "cli"), { recursive: true });
      await chmod(lorelum, 0o755);
      await chmod(root, 0o755);
      const traceId = trace("00000000-0000-4000-8000-000000000402");
      const runtime = await createProcessLogRuntime(stderr, traceId, {
        debug: false,
        rootDirectory: root,
        fallbackRootDirectory: fallback,
      });
      runtime.log.info("command.started", { invocationId: "two" });
      await runtime.flush();

      const outcome = runtime.persistenceOutcome();
      expect(outcome?.persisted).toBe(true);
      expect(outcome?.fallbackUsed).toBe(false);
      expect(outcome?.repairs?.length).toBeGreaterThanOrEqual(2);
      const text = await readSegment(root, traceId);
      expect(text).toContain("command.started");
      expect(text).toContain("log.persistence");
      expect(await managedFiles(fallback)).toEqual([]);
    }),
);

test.skipIf(process.platform === "win32")(
  "an unrepairable primary diverts the whole trace to the fallback root",
  async () =>
    withHome(async (home, root, fallback) => {
      const decoy = join(home, "decoy");
      await writeFile(decoy, "preserve me", "utf8");
      await mkdir(join(home, ".lorelum"), { recursive: true });
      await symlink(decoy, root);
      const traceId = trace("00000000-0000-4000-8000-000000000403");
      const runtime = await createProcessLogRuntime(stderr, traceId, {
        debug: false,
        rootDirectory: root,
        fallbackRootDirectory: fallback,
      });
      runtime.log.info("command.started", { invocationId: "three" });
      await runtime.flush();

      const outcome = runtime.persistenceOutcome();
      expect(outcome?.persisted).toBe(true);
      expect(outcome?.fallbackUsed).toBe(true);
      expect(outcome?.failure).toMatchObject({ kind: "location-unavailable", reason: "symlink" });
      const text = await readSegment(fallback, traceId);
      expect(text).toContain("command.started");
      expect(text).toContain("log.persistence");
      expect(await Bun.file(decoy).text()).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")(
  "when both locations are unusable the invocation completes with an unpersisted outcome only",
  async () =>
    withHome(async (home, root, fallback) => {
      for (const [target, decoy] of [
        [root, join(home, "decoy-root")],
        [fallback, join(home, "decoy-fallback")],
      ] as const) {
        await writeFile(decoy, "preserve me", "utf8");
        await mkdir(dirname(target), { recursive: true });
        await symlink(decoy, target);
      }
      const traceId = trace("00000000-0000-4000-8000-000000000404");
      const runtime = await createProcessLogRuntime(stderr, traceId, {
        debug: false,
        rootDirectory: root,
        fallbackRootDirectory: fallback,
      });
      runtime.log.info("command.started", { invocationId: "four" });
      await runtime.flush();

      const outcome = runtime.persistenceOutcome();
      expect(outcome).toMatchObject({
        persisted: false,
        fallbackUsed: false,
        failure: { kind: "location-unavailable", reason: "symlink" },
      });
      expect(await Bun.file(join(home, "decoy-root")).text()).toBe("preserve me");
      expect(await Bun.file(join(home, "decoy-fallback")).text()).toBe("preserve me");
    }),
);

test.skipIf(process.platform === "win32")(
  "a mid-run location failure never switches roots and is reported as not persisted",
  async () =>
    withHome(async (home, root, fallback) => {
      const traceId = trace("00000000-0000-4000-8000-000000000405");
      const runtime = await createProcessLogRuntime(stderr, traceId, {
        debug: false,
        rootDirectory: root,
        fallbackRootDirectory: fallback,
      });
      runtime.log.info("command.started", { invocationId: "five" });
      // Wait for the first record, then make the segment file multi-linked.
      await new Promise((resolve) => setTimeout(resolve, 25));
      const segment = join(root, "cli", daySegment(), `${traceId}.jsonl`);
      const twin = join(home, "twin.jsonl");
      await link(segment, twin);
      await unlink(segment);
      await link(twin, segment);

      runtime.log.info("command.continued", { invocationId: "five" });
      await runtime.flush();

      const outcome = runtime.persistenceOutcome();
      expect(outcome?.persisted).toBe(false);
      expect(outcome?.failure).toMatchObject({
        kind: "location-unavailable",
        reason: "multiple-links",
      });
      // No root switching: the fallback root stays empty.
      expect(await managedFiles(fallback)).toEqual([]);
      const text = await Bun.file(segment).text();
      expect(text).toContain("command.started");
      expect(text).not.toContain("command.continued");
    }),
);
