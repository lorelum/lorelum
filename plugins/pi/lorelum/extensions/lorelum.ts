import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionContext,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { readPiCatalog, type PiCatalogEvent, type PiCatalogResult } from "./cli-catalog.ts";

/** The single custom message type this integration owns and projects into a request. */
export const PACK_CATALOG_CUSTOM_TYPE = "lorelum:pack-catalog";

/** One short interactive notice shown when a lifecycle Catalog attempt fails. */
export const CATALOG_UNAVAILABLE_NOTICE =
  "Lorelum Catalog unavailable: install or update the lore CLI, then /reload.";

export interface LorelumExtensionDependencies {
  /** Internal injection seam for unit tests; production uses the `lore hook pi` reader. */
  readonly readCatalog?: (request: {
    readonly event: PiCatalogEvent;
    readonly cwd: string;
    readonly signal: AbortSignal;
  }) => Promise<PiCatalogResult>;
  readonly now?: () => number;
}

export interface LorelumRuntime {
  onSessionStart(event: SessionStartEvent, ctx: ExtensionContext): Promise<void>;
  onSessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): Promise<void>;
  onContext(event: ContextEvent): ContextEventResult | undefined;
  onShutdown(event: SessionShutdownEvent): void;
}

interface CatalogSnapshot {
  readonly text: string;
  readonly timestamp: number;
}

function isOwnProjection(message: {
  readonly role?: string;
  readonly customType?: string;
}): boolean {
  return message.role === "custom" && message.customType === PACK_CATALOG_CUSTOM_TYPE;
}

/**
 * The lifecycle runtime behind the Pi extension. It keeps the Catalog in memory
 * only: lifecycle events refresh it, the request-time `context` handler projects
 * it, and shutdown clears it. It never persists the projection or runs the CLI
 * during a model request.
 */
export function createLorelumRuntime(
  dependencies: LorelumExtensionDependencies = {},
): LorelumRuntime {
  const readCatalog = dependencies.readCatalog ?? readPiCatalog;
  const now = dependencies.now ?? Date.now;
  let snapshot: CatalogSnapshot | undefined;
  let controller: AbortController | undefined;

  const refresh = async (event: PiCatalogEvent, ctx: ExtensionContext): Promise<void> => {
    controller?.abort();
    const attempt = new AbortController();
    controller = attempt;
    // Clear the previous snapshot before waiting so a failure cannot let a stale
    // Catalog masquerade as this attempt's success.
    snapshot = undefined;
    const result = await readCatalog({ event, cwd: ctx.cwd, signal: attempt.signal });
    if (controller !== attempt) return;
    controller = undefined;
    if (result.status === "catalog") {
      snapshot = { text: result.catalog, timestamp: now() };
      return;
    }
    if (result.kind === "cancelled") return;
    if (ctx.hasUI) {
      const notice =
        result.kind === "cli-missing" || result.kind === "cli-unsupported"
          ? CATALOG_UNAVAILABLE_NOTICE
          : `Lorelum Catalog unavailable (${result.kind}): run lore pack list --details to diagnose, then /reload.`;
      ctx.ui.notify(notice, "warning");
    }
  };

  const onContext = (event: ContextEvent): ContextEventResult | undefined => {
    const remaining = event.messages.filter((message) => !isOwnProjection(message));
    if (snapshot === undefined) {
      return remaining.length === event.messages.length ? undefined : { messages: remaining };
    }
    const projection = {
      role: "custom" as const,
      customType: PACK_CATALOG_CUSTOM_TYPE,
      content: snapshot.text,
      display: false,
      timestamp: snapshot.timestamp,
    };
    return { messages: [projection, ...remaining] };
  };

  return {
    onSessionStart: (event, ctx) => refresh("session_start", ctx),
    onSessionCompact: (event, ctx) => refresh("session_compact", ctx),
    onContext,
    onShutdown: () => {
      controller?.abort();
      controller = undefined;
      snapshot = undefined;
    },
  };
}

/**
 * Pi Package extension entry point. The factory only registers lifecycle
 * handlers; it starts no process, timer, or watcher.
 */
export function lorelumExtension(
  pi: ExtensionAPI,
  dependencies: LorelumExtensionDependencies = {},
): void {
  const runtime = createLorelumRuntime(dependencies);
  pi.on("session_start", (event, ctx) => runtime.onSessionStart(event, ctx));
  pi.on("session_compact", (event, ctx) => runtime.onSessionCompact(event, ctx));
  pi.on("context", (event) => runtime.onContext(event));
  pi.on("session_shutdown", (event) => runtime.onShutdown(event));
}

export default lorelumExtension;
