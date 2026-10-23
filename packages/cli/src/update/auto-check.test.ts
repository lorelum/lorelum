import { expect, test } from "bun:test";
import type { ConfigDocument } from "@lorelum/config";
import {
  createAutoUpdateService,
  runAutoUpdateWorker,
  type AutoUpdateServiceOptions,
  type UpdateWorkerPayload,
} from "./auto-check.js";
import type { AutoUpdateState, UpdateCheckKey } from "./update-state.js";

const current = "0.1.0-alpha.6";
const next = "0.1.1";
const token = "reserved-job-1";

function stateStub(candidate: string | null | undefined): {
  readonly state: AutoUpdateState;
  readonly calls: string[];
} {
  const calls: string[] = [];
  let claimed = false;
  const state: AutoUpdateState = {
    readReady() {
      calls.push("read");
      return candidate;
    },
    reserveCheck(_key: UpdateCheckKey, _now: number, _token: string) {
      calls.push("reserve");
      return true;
    },
    reservationMatches() {
      calls.push("matches");
      return true;
    },
    finishCheck(_key, _token, version) {
      calls.push(`finish:${version ?? "none"}`);
      return true;
    },
    failCheck() {
      calls.push("fail");
      return true;
    },
    claimNotice(_current, target) {
      calls.push(`claim:${target}`);
      if (claimed) return false;
      claimed = true;
      return true;
    },
    close() {
      calls.push("close");
    },
  };
  return { state, calls };
}

function enabledConfig(): ConfigDocument {
  return { updates: { autoCheck: true } };
}

function serviceOptions(
  state: AutoUpdateState,
  overrides: Partial<AutoUpdateServiceOptions> = {},
): AutoUpdateServiceOptions {
  return {
    rootDirectory: "/isolated",
    now: () => 10_000,
    currentVersion: `${current}+local`,
    target: () => "darwin-arm64",
    readConfig: async () => enabledConfig(),
    openState: async () => state,
    startWorker() {},
    ...overrides,
  };
}

test("disabled or invalid settings skip state and network worker startup", async () => {
  let opened = 0;
  const disabled = createAutoUpdateService({
    readConfig: async () => ({ updates: { autoCheck: false } }),
    openState: async () => {
      opened++;
      throw new Error("must not open state");
    },
  });
  await expect(disabled.poll(true)).resolves.toBeUndefined();
  const malformed = createAutoUpdateService({
    readConfig: async () => ({ updates: { autoCheck: "false" } }),
    openState: async () => {
      opened++;
      throw new Error("must not open state");
    },
  });
  await expect(malformed.poll(true)).resolves.toBeUndefined();
  expect(opened).toBe(0);
});

test("a cold poll reserves once and starts a worker without doing network work in the caller", async () => {
  const { state, calls } = stateStub(undefined);
  let payload: UpdateWorkerPayload | undefined;
  const service = createAutoUpdateService(
    serviceOptions(state, {
      startWorker(value) {
        payload = value;
      },
    }),
  );
  await expect(service.poll(true)).resolves.toBeUndefined();
  expect(calls).toEqual(["read", "reserve", "close"]);
  expect(payload).toMatchObject({
    channel: "prerelease",
    target: "darwin-arm64",
    currentVersion: current,
  });
  expect(payload?.token).toMatch(/^[0-9a-f-]{36}$/);
});

test("ready notices are version-canonical, delivered only when allowed, and bounded", async () => {
  const { state, calls } = stateStub(`${next}+build.8`);
  const service = createAutoUpdateService(serviceOptions(state));
  await expect(service.poll(false)).resolves.toBeUndefined();
  expect(calls).toEqual(["read", "close"]);
  const notice = await service.poll(true);
  expect(notice).toContain(`Lorelum update available: ${next} (installed ${current}).`);
  expect(notice).toContain("Nothing changed.");
  expect(notice).toContain("Finish current task first");
  expect(notice).toContain("Run lore update to review");
  expect(notice).not.toContain("build.8");
  expect(notice!.length).toBeLessThanOrEqual(400);
  expect(calls).toEqual(["read", "close", "read", `claim:${next}`, "close"]);
  await expect(service.poll(true)).resolves.toBeUndefined();
});

test("worker accepts only its internal argv and stores a successful latest candidate", async () => {
  const { state, calls } = stateStub(undefined);
  let signal: AbortSignal | undefined;
  const payload: UpdateWorkerPayload = {
    channel: "prerelease",
    target: "darwin-arm64",
    currentVersion: current,
    token,
  };
  const result = await runAutoUpdateWorker(["--internal-update-check", JSON.stringify(payload)], {
    rootDirectory: "/isolated",
    now: () => 20_000,
    readConfig: async () => enabledConfig(),
    openState: async () => state,
    list: async (_channel, _target, receivedSignal) => {
      signal = receivedSignal;
      return [
        { version: current, notesUrl: "current" },
        { version: next, notesUrl: "next" },
      ];
    },
  });
  expect(result).toBe(true);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(calls).toEqual(["matches", `finish:${next}`, "close"]);
  await expect(runAutoUpdateWorker(["--internal-update-check", "{}"])).resolves.toBe(false);
});

test("worker failure starts cooldown and disabled settings prevent the network request", async () => {
  const failed = stateStub(undefined);
  const payload = JSON.stringify({
    channel: "prerelease",
    target: "darwin-arm64",
    currentVersion: current,
    token,
  });
  await runAutoUpdateWorker(["--internal-update-check", payload], {
    now: () => 30_000,
    readConfig: async () => enabledConfig(),
    openState: async () => failed.state,
    list: async () => {
      throw new Error("private proxy details");
    },
  });
  expect(failed.calls).toEqual(["matches", "fail", "close"]);

  let opened = 0;
  await runAutoUpdateWorker(["--internal-update-check", payload], {
    readConfig: async () => ({ updates: { autoCheck: false } }),
    openState: async () => {
      opened++;
      throw new Error("must not open");
    },
    list: async () => {
      throw new Error("must not query");
    },
  });
  expect(opened).toBe(0);
});

test("worker skips release I/O when the stored reservation no longer matches", async () => {
  const { state, calls } = stateStub(undefined);
  state.reservationMatches = () => {
    calls.push("matches");
    return false;
  };
  await runAutoUpdateWorker(
    [
      "--internal-update-check",
      JSON.stringify({
        channel: "prerelease",
        target: "darwin-arm64",
        currentVersion: current,
        token,
      }),
    ],
    {
      readConfig: async () => enabledConfig(),
      openState: async () => state,
      list: async () => {
        throw new Error("unowned jobs must not query releases");
      },
    },
  );
  expect(calls).toEqual(["matches", "close"]);
});
