import type { Logger } from "@lorelum/log";
import { sessionRefSchema } from "@lorelum/backend/client";
import type { OutputWriter } from "../output/protocol.js";
import {
  parseHostHookInvocation,
  type HostHookInvocation,
  type HostHookServices,
  type TextInput,
} from "./host-hook.js";
import { readInstalledPackDetails } from "./catalog-store.js";
import { renderInstalledPackCatalog } from "./pack-catalog.js";
import { associateShellCommand } from "./shell-association.js";
import { loadAgentHookSettings, loadSubagentPackCatalogSetting } from "./agent-settings.js";
import { createOptionalPracticeHints } from "../practice-hints/backend.js";
import { renderReadHints } from "../practice-hints/render.js";

export interface OmpHookServices extends HostHookServices {
  readonly subagentPackCatalog?: () => Promise<boolean>;
}

type OmpHookRequest =
  | { readonly event: "catalog"; readonly agentKind?: "main" | "sub" }
  | { readonly event: "shell"; readonly sessionId: string; readonly command: string }
  | { readonly event: "read-hints"; readonly sessionId: string };

function isOmpHookRequest(value: unknown): value is OmpHookRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (input.event === "catalog") {
    return (
      keys.every((key) => key === "event" || key === "agentKind") &&
      (!Object.hasOwn(input, "agentKind") ||
        input.agentKind === "main" ||
        input.agentKind === "sub")
    );
  }
  if (input.event !== "shell" && input.event !== "read-hints") return false;
  if (
    keys.length !== (input.event === "shell" ? 3 : 2) ||
    keys.some(
      (key) =>
        key !== "event" && key !== "sessionId" && (input.event !== "shell" || key !== "command"),
    ) ||
    (input.event === "shell" && typeof input.command !== "string")
  ) {
    return false;
  }
  return sessionRefSchema.safeParse({ hostKey: "omp", sessionId: input.sessionId }).success;
}

// Preserve operational diagnostics for the bridge without changing old hosts' no-op fallback.
const bridgePracticeHints = createOptionalPracticeHints(undefined, {
  onReadHintsError(error) {
    throw error;
  },
});

export interface RunOmpHookOptions {
  readonly stdin: TextInput;
  readonly stdout: OutputWriter;
  readonly stderr: OutputWriter;
  readonly services?: OmpHookServices;
  readonly storeRoot?: string;
  readonly log?: Logger;
}

/** Detect the extension bridge invocation using the shared Hook global options. */
export function parseOmpHookInvocation(
  arguments_: readonly string[],
): HostHookInvocation | undefined {
  return parseHostHookInvocation(arguments_, "omp");
}

/** Private extension bridge, not a native session Hook envelope. */
export async function runOmpHook(options: RunOmpHookOptions): Promise<0> {
  try {
    const serialized = await options.stdin.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      options.log?.debug("hook.payload.invalid", { byteLength: Buffer.byteLength(serialized) });
      throw new Error("Lorelum omp Hook input must be valid JSON.");
    }
    if (!isOmpHookRequest(parsed)) {
      throw new Error(
        "Lorelum omp Hook input must be a valid catalog, shell, or read-hints request.",
      );
    }
    const request = parsed;
    options.log?.debug("hook.payload.received", {
      byteLength: Buffer.byteLength(serialized),
      event: request.event,
    });
    let response: { additionalContext?: string; command?: string } = {};
    if (request.event === "catalog") {
      if (
        request.agentKind !== "sub" ||
        (await (options.services?.subagentPackCatalog ?? loadSubagentPackCatalogSetting)())
      ) {
        const details = await readInstalledPackDetails(options.services, options.storeRoot);
        response = { additionalContext: renderInstalledPackCatalog(details) };
      }
    } else {
      const session = sessionRefSchema.parse({ hostKey: "omp", sessionId: request.sessionId });
      if (request.event === "shell") {
        const settings = await (options.services?.agentHookSettings ?? loadAgentHookSettings)();
        const command = associateShellCommand(session, request.command, settings, "export");
        if (command !== undefined) response = { command };
      } else {
        const hints = await (
          options.services?.practiceHints ?? bridgePracticeHints
        ).readRecentHints(session.hostKey, session.sessionId);
        const additionalContext = renderReadHints(hints);
        if (additionalContext !== undefined) response = { additionalContext };
      }
    }
    options.log?.debug("hook.response.rendered", { event: request.event });
    options.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    options.log?.error("hook.degraded", { host: "omp" }, error);
    options.stderr.write(
      `lore hook omp degraded: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    options.stdout.write("{}\n");
  }
  return 0;
}
