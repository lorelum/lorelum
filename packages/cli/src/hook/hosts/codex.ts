import { sessionRefSchema } from "@lorelum/backend/client";
import type { Logger } from "@lorelum/log";
import type { CatalogReader, HookEndpoint, ReadHintReader, ShellAssociator } from "../types.js";
import { optionalEventFallback, readPayload } from "./validation.js";

interface CodexSessionStartInput {
  readonly hook_event_name: "SessionStart";
}

interface CodexPreToolUseInput {
  readonly hook_event_name: "PreToolUse" | "preToolUse";
  readonly session_id?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
}

interface CodexSubagentStartInput {
  readonly hook_event_name: "SubagentStart" | "subagentStart";
  readonly session_id?: unknown;
}

type CodexInput =
  | CodexSessionStartInput
  | CodexPreToolUseInput
  | CodexSubagentStartInput
  | { readonly hook_event_name: "PostToolUse" | "postToolUse" };

type CodexResponse = {
  readonly continue?: true;
  readonly hookSpecificOutput?:
    | {
        readonly hookEventName: "SessionStart" | "SubagentStart";
        readonly additionalContext: string;
      }
    | {
        readonly hookEventName: "PreToolUse";
        readonly permissionDecision: "allow";
        readonly updatedInput: Record<string, unknown>;
      };
};

export function createCodexEndpoint(
  services: CatalogReader & ShellAssociator & ReadHintReader,
  platform: NodeJS.Platform,
  log?: Logger,
): HookEndpoint {
  async function respond(input: CodexInput): Promise<CodexResponse> {
    switch (input.hook_event_name) {
      case "SessionStart":
        return {
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: await services.readCatalog(),
          },
        };
      case "SubagentStart":
      case "subagentStart": {
        if (typeof input.session_id !== "string" || !input.session_id) return {};
        const context = await services.readHintContext({
          hostKey: "codex",
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
        if (input.tool_name !== "Bash") return {};
        const syntax =
          platform === "win32"
            ? "powershell"
            : platform === "darwin" || platform === "linux"
              ? "posix"
              : undefined;
        if (syntax === undefined) return {};
        const session = sessionRefSchema.safeParse({
          hostKey: "codex",
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
                permissionDecision: "allow",
                updatedInput: { ...toolInput, command },
              },
            };
      }
      default:
        throw new Error("Lorelum Codex Hook received an unsupported event.");
    }
  }

  return {
    label: "Codex",
    async handle(payload, context) {
      const input = readPayload<CodexInput>(payload, "Codex", context.byteLength, log);
      const response = await respond(input);
      log?.debug("hook.response.rendered", { event: input.hook_event_name });
      return response;
    },
    fallback: optionalEventFallback,
  };
}
