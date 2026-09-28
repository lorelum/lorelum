import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { resolveLorelumPaths } from "@lorelum/config";

import { BackendError } from "../../protocol/errors";
import { checkDirectory } from "../../runtime/runtime-state";
import {
  sessionRefSchema,
  shellToolEventSchema,
  type SessionRef,
  type ShellToolEvent,
} from "./model";

const windowLifetimeMs = 30 * 60 * 1_000;

interface ActiveWindow extends SessionRef {
  readonly toolUseId: string;
  readonly cwd: string;
  readonly startedAt: number;
}

export interface SessionService {
  readonly sessionsDirectory: string;
  routeToolEvent(event: ShellToolEvent): void;
  resolve(cwd: string, explicit?: SessionRef): SessionRef | undefined;
  sessionDirectory(session: SessionRef): string;
}

export interface CreateSessionServiceOptions {
  readonly sessionsDirectory?: string;
  readonly now?: () => number;
}

export function defaultSessionsDirectory(homeDirectory = homedir()): string {
  return join(resolveLorelumPaths(homeDirectory).rootDirectory, "sessions");
}

function windowKey(event: Pick<ShellToolEvent, "hostKey" | "sessionId" | "toolUseId">): string {
  return JSON.stringify([event.hostKey, event.sessionId, event.toolUseId]);
}

function isWithin(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
}

/**
 * Shared, process-local session association and user-level session directory
 * resolver. Activity windows are intentionally not persisted.
 */
export function createSessionService(options: CreateSessionServiceOptions = {}): SessionService {
  const sessionsDirectory = resolve(options.sessionsDirectory ?? defaultSessionsDirectory());
  const now = options.now ?? Date.now;
  const windows = new Map<string, ActiveWindow>();

  function pruneWindows(time: number): void {
    for (const [key, window] of windows) {
      const age = time - window.startedAt;
      if (age < 0 || age >= windowLifetimeMs) windows.delete(key);
    }
  }

  const service: SessionService = {
    sessionsDirectory,

    routeToolEvent(event) {
      const parsed = shellToolEventSchema.safeParse(event);
      if (!parsed.success) throw new BackendError("backend.invalid-request");
      if (parsed.data.toolKind !== "shell") return;

      const time = now();
      pruneWindows(time);
      const key = windowKey(parsed.data);
      if (parsed.data.event === "post") {
        windows.delete(key);
        return;
      }
      windows.set(key, {
        hostKey: parsed.data.hostKey,
        sessionId: parsed.data.sessionId,
        toolUseId: parsed.data.toolUseId,
        cwd: resolve(parsed.data.cwd),
        startedAt: time,
      });
    },

    resolve(cwd, explicit) {
      if (explicit !== undefined) {
        const parsed = sessionRefSchema.safeParse(explicit);
        if (parsed.success) return parsed.data;
      }

      const time = now();
      pruneWindows(time);
      const workingDirectory = resolve(cwd);
      const window = [...windows.values()]
        .filter((candidate) => isWithin(candidate.cwd, workingDirectory))
        .sort(
          (left, right) => right.cwd.length - left.cwd.length || right.startedAt - left.startedAt,
        )[0];
      if (window === undefined) return undefined;
      return { hostKey: window.hostKey, sessionId: window.sessionId };
    },

    sessionDirectory(session) {
      const parsed = sessionRefSchema.safeParse(session);
      if (!parsed.success) throw new BackendError("backend.invalid-request");
      const directory = resolve(sessionsDirectory, parsed.data.hostKey, parsed.data.sessionId);
      if (!isWithin(sessionsDirectory, directory) || directory === sessionsDirectory) {
        throw new BackendError("backend.invalid-request");
      }
      return directory;
    },
  };
  return Object.freeze(service);
}

/** Check/create the private directory chain before a session file is accessed. */
export async function ensureSessionDirectory(
  sessions: SessionService,
  session: SessionRef,
): Promise<string> {
  const directory = sessions.sessionDirectory(session);
  const hostDirectory = resolve(directory, "..");
  await checkDirectory(sessions.sessionsDirectory, true);
  await checkDirectory(hostDirectory, true);
  await checkDirectory(directory, true);
  return directory;
}

/** Return undefined when the session directory has not been created yet. */
export async function existingSessionDirectory(
  sessions: SessionService,
  session: SessionRef,
): Promise<string | undefined> {
  const directory = sessions.sessionDirectory(session);
  const hostDirectory = resolve(directory, "..");
  if (!(await checkDirectory(sessions.sessionsDirectory))) return undefined;
  if (!(await checkDirectory(hostDirectory))) return undefined;
  if (!(await checkDirectory(directory))) return undefined;
  return directory;
}
