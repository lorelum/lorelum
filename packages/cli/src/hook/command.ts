import {
  createListService,
  defaultStorageRoot,
  type ListService,
  type StorageRoot,
} from "@lorelum/engine";
import type { ReadHint } from "@lorelum/backend/client";
import type { Logger } from "@lorelum/log";
import {
  loadAgentHookSettings,
  loadSubagentPackCatalogSetting,
  type AgentHookSettings,
} from "./agent-settings.js";
import { createOptionalPracticeHints } from "../practice-hints/backend.js";
import { createCatalogReader } from "./services/catalog.js";
import { createShellAssociator } from "./services/shell-association.js";
import { createReadHintReader } from "./services/read-hints.js";
import { createCodexEndpoint } from "./hosts/codex.js";
import { createClaudeEndpoint } from "./hosts/claude.js";
import { createCursorEndpoint } from "./hosts/cursor.js";
import { createWorkbuddyEndpoint } from "./hosts/workbuddy.js";
import { createZcodeEndpoint } from "./hosts/zcode.js";
import { createOmpEndpoint } from "./hosts/omp.js";
import type { HookEndpoint, HookHost } from "./types.js";

/** Injection belongs to the composition boundary, not to individual host protocols. */
export interface HookServiceOverrides {
  readonly list: Pick<ListService, "listPackDetails">;
  readonly storageRoot: StorageRoot;
  readonly practiceHints?: {
    readRecentHints(hostKey: string, sessionId: string): Promise<readonly ReadHint[]>;
  };
  readonly agentHookSettings?: () => Promise<AgentHookSettings>;
  readonly subagentPackCatalog?: () => Promise<boolean>;
  readonly platform?: NodeJS.Platform;
}

const endpointFactories = {
  codex: createCodexEndpoint,
  claude: createClaudeEndpoint,
  cursor: createCursorEndpoint,
  workbuddy: createWorkbuddyEndpoint,
  zcode: createZcodeEndpoint,
  omp: createOmpEndpoint,
} satisfies Record<HookHost, (...args: never[]) => HookEndpoint>;

export interface HookInvocation {
  readonly host: HookHost;
  readonly storeRoot?: string;
  readonly debug?: boolean;
}

/** Parse once; nonmatching or invalid invocations remain on the ordinary CLI path. */
export function parseHookInvocation(arguments_: readonly string[]): HookInvocation | undefined {
  const positionals: string[] = [];
  let storeRoot: string | undefined;
  let debug = false;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    if (argument === "--debug") {
      if (debug) return undefined;
      debug = true;
      continue;
    }
    if (argument === "--store-root") {
      const value = arguments_[index + 1];
      if (storeRoot !== undefined || typeof value !== "string" || value.length === 0)
        return undefined;
      storeRoot = value;
      index++;
      continue;
    }
    if (argument.startsWith("--store-root=")) {
      const value = argument.slice("--store-root=".length);
      if (storeRoot !== undefined || value.length === 0) return undefined;
      storeRoot = value;
      continue;
    }
    positionals.push(argument);
  }
  const host = positionals[1];
  if (
    positionals.length !== 2 ||
    positionals[0] !== "hook" ||
    host === undefined ||
    !Object.hasOwn(endpointFactories, host)
  )
    return undefined;
  return {
    host: host as HookHost,
    ...(storeRoot === undefined ? {} : { storeRoot }),
    ...(debug ? { debug } : {}),
  };
}

/** Production defaults are assembled once; only the selected operation performs IO. */
export function createHookEndpoint(
  host: HookHost,
  overrides: Partial<HookServiceOverrides> = {},
  storeRoot?: string,
  log?: Logger,
): HookEndpoint {
  const hints =
    overrides.practiceHints ??
    createOptionalPracticeHints(
      undefined,
      host === "omp"
        ? {
            onReadHintsError(error) {
              throw error;
            },
          }
        : {},
    );
  const services = {
    ...createCatalogReader(
      {
        get list() {
          return overrides.list ?? createListService();
        },
        get storageRoot() {
          return overrides.storageRoot ?? defaultStorageRoot();
        },
      },
      storeRoot,
    ),
    ...createShellAssociator(overrides.agentHookSettings ?? loadAgentHookSettings),
    ...createReadHintReader(hints),
    isSubagentCatalogEnabled: overrides.subagentPackCatalog ?? loadSubagentPackCatalogSetting,
  };
  return endpointFactories[host](services, overrides.platform ?? process.platform, log);
}

// Preserve existing diagnostic event names while consolidating their entry path.
export const hookStartEvents: Readonly<Record<HookHost, string>> = {
  omp: "catalog",
  codex: "SessionStart",
  claude: "SessionStart",
  cursor: "sessionStart",
  workbuddy: "SessionStart",
  zcode: "SessionStart",
};
