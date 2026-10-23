import { sessionRefSchema } from "@lorelum/backend/client";
import type { Logger } from "@lorelum/log";
import type { AutoUpdatePoller, CatalogReader, HookEndpoint, ShellAssociator } from "../types.js";
import { readCatalogWithUpdateNotice } from "../services/catalog.js";
import { optionalEventFallback, readPayload } from "./validation.js";

interface CursorSessionStartInput {
  readonly hook_event_name: "sessionStart";
  readonly session_id?: unknown;
  readonly conversation_id?: unknown;
}

interface CursorPreToolUseInput {
  readonly hook_event_name: "PreToolUse" | "preToolUse";
  readonly session_id?: unknown;
  readonly conversation_id?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
}

type CursorInput =
  | CursorSessionStartInput
  | CursorPreToolUseInput
  | {
      readonly hook_event_name: "PostToolUse" | "postToolUse" | "SubagentStart" | "subagentStart";
    };

type CursorResponse = {
  readonly continue?: true;
  readonly additional_context?: string;
  readonly updated_input?: Record<string, unknown>;
};

export function createCursorEndpoint(
  services: CatalogReader & { readonly autoUpdate: AutoUpdatePoller } & ShellAssociator,
  _platform: NodeJS.Platform,
  log?: Logger,
): HookEndpoint {
  async function respond(input: CursorInput): Promise<CursorResponse> {
    switch (input.hook_event_name) {
      case "sessionStart": {
        const primarySession = sessionRefSchema.safeParse({
          hostKey: "cursor",
          sessionId: input.session_id,
        });
        const conversation = primarySession.success
          ? primarySession
          : sessionRefSchema.safeParse({
              hostKey: "cursor",
              sessionId: input.conversation_id,
            });
        return {
          additional_context: await readCatalogWithUpdateNotice(services, conversation.success),
        };
      }
      case "SubagentStart":
      case "subagentStart":
      case "PostToolUse":
      case "postToolUse":
        // Cursor has no subagent context delivery channel.
        return {};
      case "PreToolUse":
      case "preToolUse": {
        if (input.tool_name !== "Shell") return {};
        // A present string session_id wins even if it subsequently fails validation.
        const sessionId =
          typeof input.session_id === "string"
            ? input.session_id
            : typeof input.conversation_id === "string"
              ? input.conversation_id
              : undefined;
        const session = sessionRefSchema.safeParse({ hostKey: "cursor", sessionId });
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
        return command === undefined ? {} : { updated_input: { ...toolInput, command } };
      }
      default:
        throw new Error("Lorelum Cursor Hook received an unsupported event.");
    }
  }

  return {
    label: "Cursor",
    async handle(payload, context) {
      const input = readPayload<CursorInput>(payload, "Cursor", context.byteLength, log);
      const response = await respond(input);
      log?.debug("hook.response.rendered", { event: input.hook_event_name });
      return response;
    },
    fallback: optionalEventFallback,
  };
}
