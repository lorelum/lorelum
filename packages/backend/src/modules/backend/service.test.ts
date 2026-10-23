import { expect, test } from "bun:test";
import { createBackendService } from "./service";

test("concurrent stop calls share one shutdown and close admission without HTTP", async () => {
  let ready = false;
  let calls = 0;
  let complete: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const service = createBackendService({
    identity: { instanceId: "test", buildIdentity: "test", protocolVersion: 1 },
    build: {
      toolVersion: "test-version",
      revision: "abc123",
      dirty: false,
      buildKind: "source",
      buildIdentity: "test",
    },
    secret: "test-only",
    isReady: () => ready,
    onStop: () => {
      calls++;
      return pending;
    },
  });
  expect(service.status().state).toBe("starting");
  ready = true;
  expect(service.available()).toBe(true);
  const first = service.stop();
  const second = service.stop();
  expect(first).toBe(second);
  expect(service.available()).toBe(false);
  expect(service.status().state).toBe("stopping");
  await Promise.resolve();
  expect(calls).toBe(1);
  complete();
  await first;
});

test("status exposes an immutable startup build provenance snapshot", () => {
  const build = {
    toolVersion: "test-version",
    revision: "abc123",
    dirty: false,
    buildKind: "source" as const,
    buildIdentity: "test",
  };
  const service = createBackendService({
    identity: { instanceId: "test-instance", buildIdentity: "test", protocolVersion: 4 },
    build,
    secret: "test-only",
    onStop: () => undefined,
  });

  build.revision = "changed-after-start";

  const status = service.status();
  expect(status).toEqual({
    state: "ready",
    model: "unloaded",
    instanceId: "test-instance",
    buildIdentity: "test",
    backendProtocolVersion: 4,
    build: {
      toolVersion: "test-version",
      revision: "abc123",
      dirty: false,
      buildKind: "source",
    },
  });
});

test("guarded stop closes admission while checking activity and ordinary stop stays permanent", async () => {
  let resolveActivity: (assessment: {
    readonly state: "active";
    readonly reason: "active-long-task";
  }) => void = () => undefined;
  let checkStarted: () => void = () => undefined;
  const checking = new Promise<void>((resolve) => {
    checkStarted = resolve;
  });
  const service = createBackendService({
    identity: { instanceId: "test-instance", buildIdentity: "test", protocolVersion: 4 },
    build: {
      toolVersion: "test-version",
      revision: "abc123",
      dirty: false,
      buildKind: "source",
      buildIdentity: "test",
    },
    secret: "test-only",
    onTryBeginIdleStop: () => {
      checkStarted();
      return new Promise((resolve) => {
        resolveActivity = resolve;
      });
    },
    onStop: () => undefined,
  });

  const attempt = service.tryBeginIdleStop();
  await checking;
  expect(service.admitBusinessRequest()).toBeUndefined();
  service.beginStop();
  resolveActivity({ state: "active", reason: "active-long-task" });

  expect(await attempt).toEqual({
    state: "accepted",
    status: expect.objectContaining({ state: "stopping" }),
  });
  expect(service.status().state).toBe("stopping");
  expect(service.admitBusinessRequest()).toBeUndefined();
});
