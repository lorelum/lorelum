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
    identity: { instanceId: "test", buildIdentity: "test", controlVersion: 1, businessVersion: 1 },
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
