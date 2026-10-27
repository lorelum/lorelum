import { sessionRefSchema } from "@lorelum/backend/client";
import type { Logger } from "@lorelum/log";
import type {
  AutoUpdatePoller,
  CatalogReader,
  HookEndpoint,
  ReadHintReader,
  ShellAssociator,
} from "../types.js";
import { readCatalogWithReadHints, readCatalogWithUpdateNotice } from "../services/catalog.js";
import { optionalEventFallback, readPayload } from "./validation.js";

interface WorkbuddySessionStartInput {
  readonly hook_event_name: "SessionStart";
  readonly session_id?: unknown;
  readonly source?: unknown;
}

interface WorkbuddyPreToolUseInput {
  readonly hook_event_name: "PreToolUse" | "preToolUse";
  readonly session_id?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
}

type WorkbuddyInput =
  | WorkbuddySessionStartInput
  | WorkbuddyPreToolUseInput
  | {
      readonly hook_event_name: "PostToolUse" | "postToolUse" | "SubagentStart" | "subagentStart";
    };

type WorkbuddyResponse = {
  readonly continue?: true;
  readonly hookSpecificOutput?:
    | { readonly hookEventName: "SessionStart"; readonly additionalContext: string }
    | { readonly hookEventName: "PreToolUse"; readonly updatedInput: Record<string, unknown> };
};

export function createWorkbuddyEndpoint(
  services: CatalogReader & { readonly autoUpdate: AutoUpdatePoller } & ShellAssociator &
    ReadHintReader,
  _platform: NodeJS.Platform,
  log?: Logger,
): HookEndpoint {
  async function respond(input: WorkbuddyInput): Promise<WorkbuddyResponse> {
    switch (input.hook_event_name) {
      case "SessionStart": {
        const session = sessionRefSchema.safeParse({
          hostKey: "workbuddy",
          sessionId: input.session_id,
        });
        return {
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext:
              input.source === "compact" && session.success
                ? await readCatalogWithReadHints(services, session.data)
                : await readCatalogWithUpdateNotice(
                    services,
                    session.success && (input.source === "startup" || input.source === "resume"),
                  ),
          },
        };
      }
      case "SubagentStart":
      case "subagentStart":
      case "PostToolUse":
      case "postToolUse":
        // WorkBuddy discards subagent Hook stdout, so no hints are read here.
        return {};
      case "PreToolUse":
      case "preToolUse": {
        if (input.tool_name !== "Bash") return {};
        const session = sessionRefSchema.safeParse({
          hostKey: "workbuddy",
          sessionId: input.session_id,
        });
        const toolInput = input.tool_input;
        if (
          !session.success ||
          typeof toolInput !== "object" ||
          toolInput === null ||
          Array.isArray(toolInput)
        )
          return {};
        if (!("command" in toolInput) || typeof toolInput.command !== "string") return {};
        const command = await services.associateShell({
          session: session.data,
          command: toolInput.command,
          syntax: "posix",
        });
        return command === undefined
          ? {}
          : {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                updatedInput: { ...toolInput, command },
              },
            };
      }
      default:
        throw new Error("Lorelum Workbuddy Hook received an unsupported event.");
    }
  }

  return {
    label: "Workbuddy",
    async handle(payload, context) {
      const input = readPayload<WorkbuddyInput>(payload, "Workbuddy", context.byteLength, log);
      const response = await respond(input);
      log?.debug("hook.response.rendered", { event: input.hook_event_name });
      return response;
    },
    fallback: optionalEventFallback,
  };
}
