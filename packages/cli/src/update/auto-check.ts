import { loadConfig, resolveLorelumPaths, type ConfigReader } from "@lorelum/config";
import { toolVersion } from "../output/protocol.js";
import { listReleases } from "./release-client.js";
import {
  defaultChannel,
  normalizeVersion,
  releaseTarget,
  selectUpdate,
  type Release,
  type UpdateChannel,
} from "./version-catalog.js";
import { loadAutoUpdateSetting } from "./update-settings.js";
import { openUpdateState, type AutoUpdateState, type UpdateCheckKey } from "./update-state.js";

export interface AutoUpdateService {
  poll(deliver: boolean): Promise<string | undefined>;
}

export interface UpdateWorkerPayload {
  readonly channel: UpdateChannel;
  readonly target: string;
  readonly currentVersion: string;
  readonly token: string;
}

export type AutoReleaseList = (
  channel: UpdateChannel,
  target: string,
  signal: AbortSignal,
) => Promise<readonly Release[]>;

export interface AutoUpdateServiceOptions {
  readonly rootDirectory?: string;
  readonly now?: () => number;
  readonly currentVersion?: string | (() => string);
  readonly target?: () => string | undefined;
  readonly readConfig?: ConfigReader;
  readonly startWorker?: (payload: UpdateWorkerPayload) => void | Promise<void>;
  readonly openState?: (rootDirectory: string) => Promise<AutoUpdateState>;
}

export interface AutoUpdateWorkerOptions {
  readonly rootDirectory?: string;
  readonly now?: () => number;
  readonly list?: AutoReleaseList;
  readonly readConfig?: ConfigReader;
  readonly openState?: (rootDirectory: string) => Promise<AutoUpdateState>;
}

const workerFlag = "--internal-update-check";
const workerTimeoutMs = 30_000;

/** Creates the optional, user-scoped automatic update sidecar. */
export function createAutoUpdateService(options: AutoUpdateServiceOptions = {}): AutoUpdateService {
  const rootDirectory = options.rootDirectory ?? resolveLorelumPaths().rootDirectory;
  const now = options.now ?? Date.now;
  const configuredVersion = options.currentVersion;
  const getCurrentVersion: () => string =
    typeof configuredVersion === "function"
      ? configuredVersion
      : () => configuredVersion ?? toolVersion;
  const getTarget = options.target ?? releaseTarget;
  const readConfig = options.readConfig ?? loadConfig;
  const openState = options.openState ?? openUpdateState;
  const startWorker = options.startWorker ?? startDetachedUpdateWorker;

  return {
    async poll(deliver) {
      if (!(await loadAutoUpdateSetting(readConfig))) return undefined;
      const currentVersion = canonicalVersion(getCurrentVersion());
      const target = getTarget();
      if (currentVersion === undefined || target === undefined) return undefined;
      const channel = defaultChannel(currentVersion);
      const key: UpdateCheckKey = { channel, target, currentVersion };

      let state: AutoUpdateState;
      try {
        state = await openState(rootDirectory);
      } catch {
        return undefined;
      }
      try {
        const timestamp = now();
        const candidate = state.readReady(key, timestamp);
        if (candidate !== undefined) {
          if (!deliver || candidate === null) return undefined;
          const targetVersion = canonicalVersion(candidate);
          if (targetVersion === undefined || Bun.semver.order(targetVersion, currentVersion) <= 0)
            return undefined;
          const notice = renderUpdateNotice(currentVersion, targetVersion);
          if (notice.length > 400) return undefined;
          return state.claimNotice(currentVersion, targetVersion, timestamp) ? notice : undefined;
        }

        const token = crypto.randomUUID();
        if (state.reserveCheck(key, timestamp, token)) {
          try {
            await startWorker({ channel, target, currentVersion, token });
          } catch {
            // The reservation already provides the failure cooldown.
            try {
              state.failCheck(key, token, now());
            } catch {
              // A read-only or damaged state file simply skips automatic updates.
            }
          }
        }
        return undefined;
      } catch {
        return undefined;
      } finally {
        try {
          state.close();
        } catch {
          // Automatic update state is optional and cannot change the host command result.
        }
      }
    },
  };
}

/** Runs only the private detached worker argv form; all worker failures are silent. */
export async function runAutoUpdateWorker(
  args: readonly string[],
  options: AutoUpdateWorkerOptions = {},
): Promise<boolean> {
  if (args.length !== 2 || args[0] !== workerFlag) return false;
  const payload = parseWorkerPayload(args[1]);
  if (payload === undefined) return false;
  if (!(await loadAutoUpdateSetting(options.readConfig ?? loadConfig))) return true;

  const rootDirectory = options.rootDirectory ?? resolveLorelumPaths().rootDirectory;
  let state: AutoUpdateState;
  try {
    state = await (options.openState ?? openUpdateState)(rootDirectory);
  } catch {
    return true;
  }
  try {
    const key: UpdateCheckKey = {
      channel: payload.channel,
      target: payload.target,
      currentVersion: payload.currentVersion,
    };
    if (!state.reservationMatches(key, payload.token)) return true;

    const signal = AbortSignal.timeout(workerTimeoutMs);
    try {
      const releases = await (options.list ?? listAutoReleases)(
        payload.channel,
        payload.target,
        signal,
      );
      const result = selectUpdate(payload.currentVersion, payload.channel, releases, false);
      const candidateVersion =
        result.status === "available" && result.latestVersion !== null
          ? (canonicalVersion(result.latestVersion) ?? null)
          : null;
      state.finishCheck(key, payload.token, candidateVersion, (options.now ?? Date.now)());
    } catch {
      try {
        state.failCheck(key, payload.token, (options.now ?? Date.now)());
      } catch {
        // The original reservation remains the cooldown if state cannot be written.
      }
    }
  } catch {
    // A read-only or damaged state simply skips automatic updates.
  } finally {
    try {
      state.close();
    } catch {
      // Detached workers never emit diagnostics to their parent or the host.
    }
  }
  return true;
}

async function startDetachedUpdateWorker(payload: UpdateWorkerPayload): Promise<void> {
  const { isCompiledEntrypoint } = await import("@lorelum/backend/control");
  const entrypoint = Bun.main;
  const command = isCompiledEntrypoint(entrypoint)
    ? [process.execPath, workerFlag, JSON.stringify(payload)]
    : [process.execPath, entrypoint, workerFlag, JSON.stringify(payload)];
  const child = Bun.spawn(command, {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  child.unref();
}

const listAutoReleases: AutoReleaseList = (channel, target, signal) =>
  listReleases(channel, target, fetch, undefined, { signal });

function parseWorkerPayload(raw: string | undefined): UpdateWorkerPayload | undefined {
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (
      typeof record.channel !== "string" ||
      typeof record.target !== "string" ||
      typeof record.currentVersion !== "string" ||
      typeof record.token !== "string"
    )
      return undefined;
    // The parent owns version/channel policy; the stored reservation identifies this job.
    return {
      channel: record.channel as UpdateChannel,
      target: record.target,
      currentVersion: record.currentVersion,
      token: record.token,
    };
  } catch {
    return undefined;
  }
}

function canonicalVersion(version: string): string | undefined {
  const normalized = normalizeVersion(version);
  return normalized === undefined ? undefined : normalized.split("+", 1)[0];
}

function renderUpdateNotice(currentVersion: string, targetVersion: string): string {
  return `Lorelum update available: ${targetVersion} (installed ${currentVersion}). Nothing changed. Finish current task first; mention this update once in final summary. Run lore update to review; do not check or install automatically. Do not ask the user about it now.`;
}
