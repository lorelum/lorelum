import { sessionRefSchema } from "@lorelum/backend/client";
import type { Logger } from "@lorelum/log";
import type {
  AutoUpdatePoller,
  CatalogReader,
  HookEndpoint,
  ReadHintReader,
  ShellAssociator,
} from "../types.js";

type OmpBridgeRequest =
  | {
      readonly event: "catalog";
      readonly agentKind?: "main" | "sub";
      readonly sessionId?: unknown;
      readonly checkUpdates?: unknown;
    }
  | { readonly event: "shell"; readonly sessionId: string; readonly command: string }
  | { readonly event: "read-hints"; readonly sessionId: string };

type OmpBridgeResponse = {
  readonly additionalContext?: string;
  readonly updateNotice?: string;
  readonly command?: string;
};

function isOmpBridgeRequest(value: unknown): value is OmpBridgeRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (input.event === "catalog") {
    return (
      keys.every(
        (key) =>
          key === "event" || key === "agentKind" || key === "sessionId" || key === "checkUpdates",
      ) &&
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
  )
    return false;
  return sessionRefSchema.safeParse({ hostKey: "omp", sessionId: input.sessionId }).success;
}

/** The extension bridge retains its own request contract, not a native Hook payload. */
export function createOmpEndpoint(
  services: CatalogReader & { readonly autoUpdate: AutoUpdatePoller } & ShellAssociator &
    ReadHintReader & {
      isSubagentCatalogEnabled(): Promise<boolean>;
    },
  platform: NodeJS.Platform,
  log?: Logger,
): HookEndpoint {
  return {
    label: "omp",
    async handle(payload, { byteLength }): Promise<OmpBridgeResponse> {
      if (!isOmpBridgeRequest(payload)) {
        throw new Error(
          "Lorelum omp Hook input must be a valid catalog, shell, or read-hints request.",
        );
      }
      log?.debug("hook.payload.received", { byteLength, event: payload.event });
      let response: OmpBridgeResponse = {};
      switch (payload.event) {
        case "catalog":
          if (payload.agentKind !== "sub" || (await services.isSubagentCatalogEnabled())) {
            response = { additionalContext: await services.readCatalog() };
            const session = sessionRefSchema.safeParse({
              hostKey: "omp",
              sessionId: payload.sessionId,
            });
            if (payload.agentKind === "main" && payload.checkUpdates === true && session.success) {
              try {
                const updateNotice = await services.autoUpdate.poll(true);
                if (updateNotice) response = { ...response, updateNotice };
              } catch {
                // Update discovery cannot degrade the ordinary Catalog bridge.
              }
            }
          }
          break;
        case "shell": {
          const command = await services.associateShell({
            session: { hostKey: "omp", sessionId: payload.sessionId },
            command: payload.command,
            syntax: platform === "win32" ? "powershell" : "posix",
          });
          if (command !== undefined) response = { command };
          break;
        }
        case "read-hints": {
          const additionalContext = await services.readHintContext({
            hostKey: "omp",
            sessionId: payload.sessionId,
          });
          if (additionalContext !== undefined) response = { additionalContext };
          break;
        }
      }
      log?.debug("hook.response.rendered", { event: payload.event });
      return response;
    },
    fallback: () => ({}),
  };
}
