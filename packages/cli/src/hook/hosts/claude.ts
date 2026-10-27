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

interface ClaudeSessionStartInput {
  readonly hook_event_name: "SessionStart";
  readonly session_id?: unknown;
  readonly source?: unknown;
}

interface ClaudePreToolUseInput {
  readonly hook_event_name: "PreToolUse" | "preToolUse";
  readonly session_id?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
}

interface ClaudeSubagentStartInput {
  readonly hook_event_name: "SubagentStart" | "subagentStart";
  readonly session_id?: unknown;
}

type ClaudeInput =
  | ClaudeSessionStartInput
  | ClaudePreToolUseInput
  | ClaudeSubagentStartInput
  | { readonly hook_event_name: "PostToolUse" | "postToolUse" };

type ClaudeResponse = {
  readonly continue?: true;
  readonly hookSpecificOutput?:
    | {
        readonly hookEventName: "SessionStart" | "SubagentStart";
        readonly additionalContext: string;
      }
    | { readonly hookEventName: "PreToolUse"; readonly updatedInput: Record<string, unknown> };
};

export function createClaudeEndpoint(
  services: CatalogReader & { readonly autoUpdate: AutoUpdatePoller } & ShellAssociator &
    ReadHintReader,
  _platform: NodeJS.Platform,
  log?: Logger,
): HookEndpoint {
  async function respond(input: ClaudeInput): Promise<ClaudeResponse> {
    switch (input.hook_event_name) {
      case "SessionStart": {
        const session = sessionRefSchema.safeParse({
          hostKey: "claude",
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
      case "subagentStart": {
        if (typeof input.session_id !== "string" || !input.session_id) return {};
        const context = await services.readHintContext({
          hostKey: "claude",
          sessionId: input.session_id,
        });
        return context === undefined
          ? {}
          : {
              hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: context },
            };
      }
      case "PostToolUse":
      case "postToolUse":
        return {};
      case "PreToolUse":
      case "preToolUse": {
        // Claude's tool selects syntax even when Bash runs on Windows.
        const syntax =
          input.tool_name === "Bash"
            ? "posix"
            : input.tool_name === "PowerShell"
              ? "powershell"
              : undefined;
        if (syntax === undefined) return {};
        const session = sessionRefSchema.safeParse({
          hostKey: "claude",
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
          syntax,
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
        throw new Error("Lorelum Claude Code Hook received an unsupported event.");
    }
  }

  return {
    label: "Claude Code",
    async handle(payload, context) {
      const input = readPayload<ClaudeInput>(payload, "Claude Code", context.byteLength, log);
      const response = await respond(input);
      log?.debug("hook.response.rendered", { event: input.hook_event_name });
      return response;
    },
    fallback: optionalEventFallback,
  };
}
