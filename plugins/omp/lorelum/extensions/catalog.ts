import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { createSessionHandoff } from "./session-handoff";
import {
  createBridgeExecutor,
  type BridgeExecution,
  type BridgeExecutor,
  type BridgeRequest,
} from "./subprocess";

const MAX_CATALOG_CHARS = 4_000;
const MAX_READ_HINTS_CHARS = 1_800;
const MAX_UPDATE_NOTICE_CHARS = 400;
const DIAGNOSTIC =
  "Lorelum Catalog was not injected; check that the installed lore CLI supports `lore hook omp`, then reload omp.";
type RequestMessage = Extract<ContextEvent["messages"][number], { role: "user" }>;

function parseResponse(result: BridgeExecution): Record<string, unknown> {
  if (result.code !== 0) throw new Error("CLI exited unsuccessfully");
  // One JSON line is the entire private bridge response; never forward CLI output blindly.
  const line = result.stdout.trim();
  if (line.includes("\n") || line.includes("\r")) throw new Error("Invalid bridge response");
  const response: unknown = JSON.parse(line);
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new Error("Invalid bridge response");
  }
  return response as Record<string, unknown>;
}

export function registerLorelum(
  api: ExtensionAPI,
  execute: BridgeExecutor = createBridgeExecutor(),
): void {
  let generation = 0;
  let needsRefresh = true;
  let metadata: RequestMessage[] = [];
  let pendingNotice: RequestMessage | undefined;
  let pending: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let diagnosed = false;
  let stopped = false;
  let lastSessionId: string | undefined;
  let updateEligibleSessionId: string | undefined;
  let updateCheckPending = true;
  const shellControllers = new Set<AbortController>();
  const ownMessages = new WeakSet<ContextEvent["messages"][number]>();

  const invalidate = () => {
    generation++;
    needsRefresh = !stopped;
    metadata = [];
    pendingNotice = undefined;
    controller?.abort();
    controller = undefined;
    pending = undefined;
    for (const shellController of shellControllers) shellController.abort();
    shellControllers.clear();
  };
  const invalidateForSession = (ctx: ExtensionContext, allowSameSession: boolean): void => {
    const sessionId = ctx.sessionManager.getSessionId();
    const changed = sessionId !== lastSessionId;
    invalidate();
    lastSessionId = sessionId;
    updateCheckPending =
      ctx.agent.kind === "main" &&
      typeof sessionId === "string" &&
      sessionId.trim().length > 0 &&
      (allowSameSession || changed);
    updateEligibleSessionId = updateCheckPending ? sessionId : undefined;
  };
  const handoff = createSessionHandoff(invalidate);
  api.on("before_subagent_spawn", (event, ctx) => {
    if (!stopped) handoff.capture(event, ctx);
  });
  api.on("session_start", (_event, ctx) => {
    invalidateForSession(ctx, true);
    handoff.bind(ctx);
  });
  api.on("session_switch", (_event, ctx) => invalidateForSession(ctx, false));
  api.on("session_branch", (_event, ctx) => invalidateForSession(ctx, false));
  api.on("session_tree", (_event, ctx) => invalidateForSession(ctx, false));
  api.on("session_compact", (_event, ctx) => invalidateForSession(ctx, false));
  api.on("session_shutdown", () => {
    stopped = true;
    invalidate();
    updateCheckPending = false;
    updateEligibleSessionId = undefined;
    handoff.shutdown();
  });

  api.on("tool_call", async (event, ctx) => {
    if (stopped || event.toolName !== "bash" || typeof event.input.command !== "string") {
      return;
    }
    const requestGeneration = generation;
    const shellController = new AbortController();
    shellControllers.add(shellController);
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      if (!sessionId) return;
      const response = parseResponse(
        await execute({
          cwd: ctx.cwd,
          signal: shellController.signal,
          request: { event: "shell", sessionId, command: event.input.command },
        }),
      );
      if (
        generation !== requestGeneration ||
        shellController.signal.aborted ||
        typeof response.command !== "string" ||
        response.command.trim().length === 0 ||
        response.command === event.input.command
      ) {
        return;
      }
      // Only replace command. Native approval still evaluates the actual input.
      return { input: { ...event.input, command: response.command } };
    } catch {
      // Missing/old CLI or a failed rewrite cannot change the original tool call.
      return;
    } finally {
      shellControllers.delete(shellController);
    }
  });

  const diagnoseCatalog = (ctx: ExtensionContext) => {
    if (diagnosed) return;
    diagnosed = true;
    if (ctx.hasUI) {
      try {
        ctx.ui.notify(DIAGNOSTIC, "warning");
        return;
      } catch {
        // Fall back to stderr if the UI cannot display the diagnosis.
      }
    }
    try {
      process.stderr.write(`${DIAGNOSTIC}\n`);
    } catch {
      // A diagnostic sink failure must not reject the model request.
    }
  };

  api.on("context", async (event, ctx): Promise<ContextEventResult> => {
    const requestGeneration = generation;
    if (needsRefresh) {
      needsRefresh = false;
      metadata = [];
      pendingNotice = undefined;
      const readController = new AbortController();
      controller = readController;
      const mainSessionId = handoff.mainSessionId(ctx);
      const sessionId = ctx.sessionManager.getSessionId();
      const checkUpdates =
        updateCheckPending &&
        ctx.agent.kind === "main" &&
        typeof sessionId === "string" &&
        sessionId.trim().length > 0 &&
        (updateEligibleSessionId === undefined || updateEligibleSessionId === sessionId);
      lastSessionId = sessionId;
      updateCheckPending = false;
      updateEligibleSessionId = undefined;
      const readMetadata = async (
        request: BridgeRequest,
        maxChars: number,
      ): Promise<RequestMessage | undefined> => {
        try {
          let response = parseResponse(
            await execute({ cwd: ctx.cwd, signal: readController.signal, request }),
          );
          if (generation !== requestGeneration || readController.signal.aborted) return;
          if (
            request.event === "catalog" &&
            request.agentKind === "main" &&
            request.checkUpdates === true &&
            Object.keys(response).length === 0
          ) {
            response = parseResponse(
              await execute({
                cwd: ctx.cwd,
                signal: readController.signal,
                request: { event: "catalog", agentKind: "main" },
              }),
            );
            if (generation !== requestGeneration || readController.signal.aborted) return;
          }
          // Empty candidates and an explicitly disabled subagent Catalog are normal no-ops.
          if (
            response.additionalContext === undefined &&
            (request.event === "read-hints" ||
              (request.event === "catalog" &&
                request.agentKind === "sub" &&
                Object.keys(response).length === 0))
          )
            return;
          if (
            typeof response.additionalContext !== "string" ||
            response.additionalContext.trim().length === 0 ||
            response.additionalContext.length > maxChars
          ) {
            throw new Error("No usable metadata in bridge response");
          }
          if (
            request.event === "catalog" &&
            request.agentKind === "main" &&
            request.checkUpdates === true &&
            ctx.agent.kind === "main" &&
            typeof response.updateNotice === "string" &&
            response.updateNotice.trim().length > 0 &&
            response.updateNotice.length <= MAX_UPDATE_NOTICE_CHARS
          ) {
            pendingNotice = {
              role: "user",
              content: [{ type: "text", text: response.updateNotice }],
              timestamp: Date.now(),
            };
            ownMessages.add(pendingNotice);
          }
          // Omp converts ordinary custom messages to developer priority.
          // Native user metadata avoids elevating Pack descriptions or read hints into policy.
          return {
            role: "user",
            content: [{ type: "text", text: response.additionalContext }],
            timestamp: Date.now(),
          };
        } catch {
          if (generation !== requestGeneration || readController.signal.aborted) return;
          if (request.event === "catalog") diagnoseCatalog(ctx);
          return;
        }
      };
      pending = (async () => {
        try {
          const snapshots = await Promise.all([
            readMetadata(
              {
                event: "catalog",
                agentKind: ctx.agent.kind === "sub" ? "sub" : "main",
                ...(checkUpdates ? { sessionId, checkUpdates: true } : {}),
              },
              MAX_CATALOG_CHARS,
            ),
            mainSessionId
              ? readMetadata(
                  { event: "read-hints", sessionId: mainSessionId },
                  MAX_READ_HINTS_CHARS,
                )
              : undefined,
          ]);
          if (generation !== requestGeneration || readController.signal.aborted) return;
          for (const snapshot of snapshots) {
            if (!snapshot) continue;
            metadata.push(snapshot);
            ownMessages.add(snapshot);
          }
        } finally {
          if (generation === requestGeneration) controller = undefined;
        }
      })();
    }
    await pending;
    const snapshots = generation === requestGeneration ? metadata : [];
    const notice = generation === requestGeneration ? pendingNotice : undefined;
    if (generation === requestGeneration) pendingNotice = undefined;
    const injected = notice ? [notice, ...snapshots] : snapshots;
    // Identity-only removal: identical real user text and other extension messages survive.
    const hasOwnMessage = event.messages.some((message) => ownMessages.has(message));
    if (injected.length === 0 && !hasOwnMessage) return { messages: event.messages };
    if (
      injected.length > 0 &&
      injected.every((snapshot, index) => event.messages[index] === snapshot) &&
      event.messages.every((message, index) => index < injected.length || !ownMessages.has(message))
    ) {
      return { messages: event.messages };
    }
    const messages: ContextEvent["messages"] = [...injected];
    for (const message of event.messages) {
      if (!ownMessages.has(message)) messages.push(message);
    }
    return { messages };
  });
}

export default function lorelum(api: ExtensionAPI): void {
  registerLorelum(api);
}
