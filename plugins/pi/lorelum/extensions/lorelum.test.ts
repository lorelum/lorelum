import { expect, test } from "bun:test";
import type {
  ContextEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import {
  CATALOG_UNAVAILABLE_NOTICE,
  PACK_CATALOG_CUSTOM_TYPE,
  createLorelumRuntime,
  lorelumExtension,
} from "./lorelum.ts";
import type { PiCatalogResult } from "./cli-catalog.ts";

interface CatalogRequest {
  readonly event: string;
  readonly cwd: string;
  readonly signal: AbortSignal;
}

function catalogReader(results: readonly PiCatalogResult[]): {
  readonly requests: CatalogRequest[];
  readonly readCatalog: (request: CatalogRequest) => Promise<PiCatalogResult>;
} {
  const requests: CatalogRequest[] = [];
  const readCatalog = async (request: CatalogRequest): Promise<PiCatalogResult> => {
    requests.push(request);
    return results[requests.length - 1] ?? { status: "unavailable", kind: "cli-error" };
  };
  return { requests, readCatalog };
}

function deferredReader(): {
  readonly calls: Array<{ request: CatalogRequest; resolve: (result: PiCatalogResult) => void }>;
  readonly readCatalog: (request: CatalogRequest) => Promise<PiCatalogResult>;
} {
  const calls: Array<{ request: CatalogRequest; resolve: (result: PiCatalogResult) => void }> = [];
  const readCatalog = (request: CatalogRequest): Promise<PiCatalogResult> =>
    new Promise((resolve) => calls.push({ request, resolve }));
  return { calls, readCatalog };
}

function context(options: { cwd?: string; hasUI?: boolean } = {}): {
  readonly ctx: ExtensionContext;
  readonly notices: string[];
} {
  const notices: string[] = [];
  const ctx = {
    cwd: options.cwd ?? "/work",
    hasUI: options.hasUI ?? false,
    ui: { notify: (message: string) => notices.push(message) },
  } as unknown as ExtensionContext;
  return { ctx, notices };
}

function startEvent(reason: SessionStartEvent["reason"] = "startup"): SessionStartEvent {
  return { type: "session_start", reason };
}

function compactEvent(): SessionCompactEvent {
  return {
    type: "session_compact",
    reason: "manual",
    fromExtension: false,
    willRetry: false,
  } as unknown as SessionCompactEvent;
}

function shutdownEvent(): SessionShutdownEvent {
  return { type: "session_shutdown", reason: "quit" } as unknown as SessionShutdownEvent;
}

function contextEvent(messages: readonly unknown[]): ContextEvent {
  return { type: "context", messages } as unknown as ContextEvent;
}

type CatalogMessage = ContextEvent["messages"][number];

function asMessage(value: object): CatalogMessage {
  return value as unknown as CatalogMessage;
}

const user = asMessage({ role: "user", content: "hello" });
const toolCall = asMessage({ role: "assistant", content: [{ type: "toolCall", id: "t1" }] });
const toolResult = asMessage({
  role: "toolResult",
  content: [{ type: "toolResult", toolCallId: "t1" }],
});

test("the factory registers only the four lifecycle handlers and starts nothing", () => {
  const events: string[] = [];
  let reads = 0;
  const pi = {
    on: (event: string) => {
      events.push(event);
      return () => {};
    },
  } as unknown as ExtensionAPI;

  lorelumExtension(pi, {
    readCatalog: async () => {
      reads += 1;
      return { status: "catalog", catalog: "Catalog" };
    },
  });

  expect(events).toEqual(["session_start", "session_compact", "context", "session_shutdown"]);
  expect(reads).toBe(0);
});

for (const reason of ["startup", "reload", "new", "resume", "fork"] as const) {
  test(`refreshes the Catalog for every session_start reason (${reason})`, async () => {
    const reader = catalogReader([{ status: "catalog", catalog: "Catalog" }]);
    const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog });
    const { ctx } = context();

    await runtime.onSessionStart(startEvent(reason), ctx);

    expect(reader.requests).toHaveLength(1);
    expect(reader.requests[0]).toMatchObject({ event: "session_start", cwd: "/work" });
    expect(reader.requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });
}

test("refreshes after a successful compact through the session_compact event", async () => {
  const reader = catalogReader([{ status: "catalog", catalog: "Catalog" }]);
  const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog });
  const { ctx } = context();

  await runtime.onSessionCompact(compactEvent(), ctx);

  expect(reader.requests).toHaveLength(1);
  expect(reader.requests[0]?.event).toBe("session_compact");
});

test("projects exactly one owned catalog at the front and preserves other messages", async () => {
  const reader = catalogReader([{ status: "catalog", catalog: "Catalog text" }]);
  const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog, now: () => 1234 });
  const { ctx } = context();
  await runtime.onSessionStart(startEvent(), ctx);

  const stale = {
    role: "custom",
    customType: PACK_CATALOG_CUSTOM_TYPE,
    content: "old",
    display: false,
    timestamp: 1,
  };
  const result = runtime.onContext(contextEvent([user, toolCall, stale, toolResult]));

  expect(result?.messages).toHaveLength(4);
  expect(result?.messages?.[0]).toMatchObject({
    role: "custom",
    customType: PACK_CATALOG_CUSTOM_TYPE,
    content: "Catalog text",
    display: false,
    timestamp: 1234,
  });
  expect(result?.messages?.[1]).toBe(user);
  expect(result?.messages?.[2]).toBe(toolCall);
  expect(result?.messages?.[3]).toBe(toolResult);
  expect(
    result?.messages?.filter(
      (message) =>
        (message as { role?: string; customType?: string }).role === "custom" &&
        (message as { role?: string; customType?: string }).customType === PACK_CATALOG_CUSTOM_TYPE,
    ),
  ).toHaveLength(1);
});

test("reuses the snapshot across tree navigation and ordinary requests without another CLI call", async () => {
  const reader = catalogReader([{ status: "catalog", catalog: "Catalog" }]);
  const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog, now: () => 42 });
  const { ctx } = context();
  await runtime.onSessionStart(startEvent(), ctx);

  const first = runtime.onContext(contextEvent([user]));
  const second = runtime.onContext(contextEvent([user, toolCall]));

  expect(reader.requests).toHaveLength(1);
  expect(first?.messages?.[0]).toMatchObject({ timestamp: 42, content: "Catalog" });
  expect(second?.messages?.[0]).toMatchObject({ timestamp: 42, content: "Catalog" });
});

test("a failed refresh clears the old snapshot instead of re-injecting it", async () => {
  const reader = catalogReader([
    { status: "catalog", catalog: "Old Catalog" },
    { status: "unavailable", kind: "timeout" },
  ]);
  const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog });
  const { ctx } = context();
  await runtime.onSessionStart(startEvent(), ctx);
  expect(runtime.onContext(contextEvent([user]))?.messages?.[0]).toMatchObject({
    content: "Old Catalog",
  });

  await runtime.onSessionCompact(compactEvent(), ctx);

  expect(runtime.onContext(contextEvent([user]))).toBeUndefined();
});

test("a superseded attempt cannot overwrite a newer snapshot", async () => {
  const reader = deferredReader();
  const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog, now: () => 1 });
  const { ctx } = context();

  const first = runtime.onSessionStart(startEvent(), ctx);
  const second = runtime.onSessionCompact(compactEvent(), ctx);
  expect(reader.calls).toHaveLength(2);

  reader.calls[1]?.resolve({ status: "catalog", catalog: "New Catalog" });
  await second;
  reader.calls[0]?.resolve({ status: "catalog", catalog: "Old Catalog" });
  await first;

  expect(runtime.onContext(contextEvent([user]))?.messages?.[0]).toMatchObject({
    content: "New Catalog",
  });
});

test("notifies once interactively, stays silent non-interactively, and never notifies on cancellation", async () => {
  const interactiveReader = catalogReader([{ status: "unavailable", kind: "cli-missing" }]);
  const runtime = createLorelumRuntime({ readCatalog: interactiveReader.readCatalog });
  const interactive = context({ hasUI: true });

  await runtime.onSessionStart(startEvent(), interactive.ctx);
  expect(interactive.notices).toEqual([CATALOG_UNAVAILABLE_NOTICE]);

  runtime.onContext(contextEvent([]));
  runtime.onContext(contextEvent([]));
  expect(interactive.notices).toHaveLength(1);

  const quiet = context({ hasUI: false });
  await runtime.onSessionStart(startEvent(), quiet.ctx);
  expect(quiet.notices).toEqual([]);

  const cancelledReader = catalogReader([{ status: "unavailable", kind: "cancelled" }]);
  const cancelledRuntime = createLorelumRuntime({ readCatalog: cancelledReader.readCatalog });
  const cancelled = context({ hasUI: true });
  await cancelledRuntime.onSessionStart(startEvent(), cancelled.ctx);
  expect(cancelled.notices).toEqual([]);
});

test.each(["cli-error", "timeout", "invalid-response", "cli-unsupported"] as const)(
  "failure notices give the correct recovery action for %s",
  async (kind) => {
    const reader = catalogReader([{ status: "unavailable", kind }]);
    const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog });
    const { ctx, notices } = context({ hasUI: true });
    await runtime.onSessionStart(startEvent(), ctx);
    expect(notices).toHaveLength(1);
    if (kind === "cli-unsupported") {
      expect(notices[0]).toBe(CATALOG_UNAVAILABLE_NOTICE);
    } else {
      expect(notices[0]).toContain(kind);
      expect(notices[0]).toContain("lore pack list --details");
    }
    expect(runtime.onContext(contextEvent([user]))).toBeUndefined();
  },
);

test("shutdown aborts in-flight work, clears the snapshot, and is idempotent", async () => {
  const reader = deferredReader();
  const runtime = createLorelumRuntime({ readCatalog: reader.readCatalog });
  const { ctx } = context();

  void runtime.onSessionStart(startEvent(), ctx);
  const signal = reader.calls[0]?.request.signal;
  expect(signal?.aborted).toBe(false);

  runtime.onShutdown(shutdownEvent());
  expect(signal?.aborted).toBe(true);
  runtime.onShutdown(shutdownEvent());

  expect(runtime.onContext(contextEvent([user]))).toBeUndefined();
});
