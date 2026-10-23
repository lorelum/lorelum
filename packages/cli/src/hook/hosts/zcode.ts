import { sessionRefSchema } from "@lorelum/backend/client";
import type { Logger } from "@lorelum/log";
import type { AutoUpdatePoller, CatalogReader, HookEndpoint, ShellAssociator } from "../types.js";
import { readCatalogWithUpdateNotice } from "../services/catalog.js";
import { readPayload } from "./validation.js";

interface ZcodeSessionStartInput {
  readonly hook_event_name: "SessionStart";
  readonly session_id?: unknown;
  readonly source?: unknown;
}

interface ZcodePreToolUseInput {
  readonly hook_event_name: "PreToolUse";
  readonly session_id?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
}

type ZcodeInput = ZcodeSessionStartInput | ZcodePreToolUseInput;

type ZcodeResponse = {
  readonly continue?: true;
  readonly hookSpecificOutput?:
    | { readonly hookEventName: "SessionStart"; readonly additionalContext: string }
    | { readonly hookEventName: "PreToolUse"; readonly updatedInput: Record<string, unknown> };
};

export function createZcodeEndpoint(
  services: CatalogReader & { readonly autoUpdate: AutoUpdatePoller } & ShellAssociator,
  platform: NodeJS.Platform,
  log?: Logger,
): HookEndpoint {
  async function respond(input: ZcodeInput): Promise<ZcodeResponse> {
    switch (input.hook_event_name) {
      case "SessionStart": {
        const session = sessionRefSchema.safeParse({
          hostKey: "zcode",
          sessionId: input.session_id,
        });
        return {
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: await readCatalogWithUpdateNotice(
              services,
              session.success && (input.source === "startup" || input.source === "resume"),
            ),
          },
        };
      }
      case "PreToolUse": {
        if (input.tool_name !== "Bash") return {};
        if (platform !== "darwin" && platform !== "linux" && platform !== "win32") return {};
        const session = sessionRefSchema.safeParse({
          hostKey: "zcode",
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
        throw new Error("Lorelum Zcode Hook received an unsupported event.");
    }
  }

  return {
    label: "Zcode",
    async handle(payload, context) {
      const input = readPayload<ZcodeInput>(payload, "Zcode", context.byteLength, log);
      const response = await respond(input);
      log?.debug("hook.response.rendered", { event: input.hook_event_name });
      return response;
    },
    // Unlike the other native hosts, ZCode also continues on tool failures.
    fallback: () => ({ continue: true }),
  };
}
