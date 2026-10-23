import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BackendError } from "../protocol/errors";
import {
  activityPath,
  assessRuntimeActivity,
  assessRuntimeActivityV4,
  grantTaskLease,
  initializeActivityRecord,
  readActivityRecord,
  releaseTaskLease,
  renewTaskLease,
  setRuntimeActivity,
} from "./activity-state";

const instanceId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const owner = { pid: process.pid, startedAt: "test-owner" };

async function fixture(run: (directory: string) => Promise<void>) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "lorelum-activity-")));
  const directory = join(temporary, "runtime");
  try {
    await run(directory);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

test("activity record distinguishes idle, active, and unknown state", async () =>
  fixture(async (directory) => {
    expect(assessRuntimeActivity(undefined, instanceId)).toEqual({
      state: "unknown",
      reason: "unknown-activity",
    });
    await initializeActivityRecord(directory, instanceId);
    const idle = await readActivityRecord(directory);
    expect(assessRuntimeActivity(idle, instanceId)).toEqual({
      state: "active",
      reason: "active-long-task",
    });
    await setRuntimeActivity(directory, instanceId, "daemon-startup", false);
    const ready = await readActivityRecord(directory);
    expect(assessRuntimeActivity(ready, instanceId)).toEqual({ state: "idle", reason: "idle" });
    await setRuntimeActivity(directory, instanceId, "index-operation", true);
    expect(assessRuntimeActivity(await readActivityRecord(directory), instanceId)).toEqual({
      state: "active",
      reason: "active-long-task",
    });
  }));

test("valid leases protect activity, while expired leases defer automatic recovery", async () =>
  fixture(async (directory) => {
    await initializeActivityRecord(directory, instanceId);
    await setRuntimeActivity(directory, instanceId, "daemon-startup", false);
    const grant = await grantTaskLease(directory, instanceId, owner, 1_000, 1_000);
    expect(assessRuntimeActivity(await readActivityRecord(directory), instanceId, 1_500)).toEqual({
      state: "active",
      reason: "active-long-task",
    });
    expect(assessRuntimeActivity(await readActivityRecord(directory), instanceId, 2_000)).toEqual({
      state: "unknown",
      reason: "unknown-activity",
    });
    const renewed = await renewTaskLease(directory, instanceId, grant.leaseId, owner, 1_000, 2_000);
    expect(renewed.leaseId).toBe(grant.leaseId);
    await releaseTaskLease(directory, instanceId, grant.leaseId);
    expect(assessRuntimeActivity(await readActivityRecord(directory), instanceId, 2_100)).toEqual({
      state: "idle",
      reason: "idle",
    });
  }));

test("v4 ignores expired leases and a new lease write prunes expired entries", async () =>
  fixture(async (directory) => {
    await initializeActivityRecord(directory, instanceId);
    await setRuntimeActivity(directory, instanceId, "daemon-startup", false);
    await grantTaskLease(directory, instanceId, owner, 1_000, 1_000);

    const expired = await readActivityRecord(directory);
    expect(assessRuntimeActivity(expired, instanceId, 2_000)).toEqual({
      state: "unknown",
      reason: "unknown-activity",
    });
    expect(assessRuntimeActivityV4(expired, instanceId, 2_000)).toEqual({
      state: "idle",
      reason: "idle",
    });

    const activeLease = await grantTaskLease(directory, instanceId, owner, 1_000, 2_000);
    const withActiveLease = await readActivityRecord(directory);
    expect(withActiveLease?.leases.map((lease) => lease.leaseId)).toEqual([activeLease.leaseId]);
    expect(assessRuntimeActivityV4(withActiveLease, instanceId, 2_500)).toEqual({
      state: "active",
      reason: "active-long-task",
    });
    expect(assessRuntimeActivityV4(withActiveLease, instanceId, 3_000)).toEqual({
      state: "idle",
      reason: "idle",
    });
  }));

test("v3 lease writes preserve the old expired-lease guard", async () =>
  fixture(async (directory) => {
    await initializeActivityRecord(directory, instanceId);
    await setRuntimeActivity(directory, instanceId, "daemon-startup", false);
    const expired = await grantTaskLease(directory, instanceId, owner, 1_000, 1_000, 3);
    const fresh = await grantTaskLease(directory, instanceId, owner, 1_000, 2_000, 3);
    await renewTaskLease(directory, instanceId, fresh.leaseId, owner, 1_000, 2_500, 3);
    expect((await readActivityRecord(directory))?.leases.map((lease) => lease.leaseId)).toContain(
      expired.leaseId,
    );
    await releaseTaskLease(directory, instanceId, fresh.leaseId);
    expect(assessRuntimeActivity(await readActivityRecord(directory), instanceId, 2_500)).toEqual({
      state: "unknown",
      reason: "unknown-activity",
    });
  }));

test("malformed activity state is rejected rather than treated as idle", async () =>
  fixture(async (directory) => {
    await initializeActivityRecord(directory, instanceId);
    await writeFile(activityPath(directory), "{broken", { mode: 0o600 });
    await expect(readActivityRecord(directory)).rejects.toEqual(
      expect.objectContaining({ code: "backend.state-invalid" } satisfies Partial<BackendError>),
    );
  }));
