import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";

import { MAX_RESPONSE_BYTES } from "../../protocol/constants";
import { BackendError } from "../../protocol/errors";
import { assertPrivateFile, hasCode } from "../../runtime/runtime-state";
import {
  createSessionService,
  ensureSessionDirectory,
  existingSessionDirectory,
  type SessionService,
} from "../sessions/service";
import type { SessionRef } from "../sessions/model";
import {
  persistedReadHintSchema,
  readHintsQuerySchema,
  successfulGetReportSchema,
  type PersistedReadHint,
  type ReadHint,
  type ShellToolEvent,
} from "./model";

const maxRecentHints = 100;

export interface PracticeHintService {
  routeToolEvent(event: ShellToolEvent): Promise<void>;
  recordSuccessfulGet(cwd: string, hint: ReadHint, session?: SessionRef): Promise<void>;
  readRecentHints(hostKey: string, sessionId: string): Promise<ReadHint[]>;
}

export interface CreatePracticeHintServiceOptions {
  readonly sessions?: SessionService;
  readonly sessionsDirectory?: string;
  readonly now?: () => number;
}

function isMissing(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}

/**
 * Backend-owned Practice read metadata. Session association and session paths
 * are provided by the shared Sessions module.
 */
export function createPracticeHintService(
  options: CreatePracticeHintServiceOptions = {},
): PracticeHintService {
  const sessions =
    options.sessions ??
    createSessionService({
      ...(options.sessionsDirectory === undefined
        ? {}
        : { sessionsDirectory: options.sessionsDirectory }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  const now = options.now ?? Date.now;

  async function append(record: PersistedReadHint): Promise<void> {
    const session = { hostKey: record.hostKey, sessionId: record.sessionId };
    try {
      const sessionDirectory = await ensureSessionDirectory(sessions, session);
      const path = join(sessionDirectory, "practice-reads.jsonl");
      await assertPrivateFile(path);
      const file = await open(
        path,
        constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        const details = await file.stat();
        if (
          !details.isFile() ||
          details.nlink !== 1 ||
          (process.platform !== "win32" &&
            (details.uid !== process.getuid?.() || (details.mode & 0o077) !== 0))
        ) {
          throw new BackendError("backend.state-invalid");
        }
        let separator = "";
        if (details.size > 0) {
          const lastByte = Buffer.alloc(1);
          const { bytesRead } = await file.read(lastByte, 0, 1, details.size - 1);
          if (bytesRead !== 1) throw new BackendError("backend.state-invalid");
          if (lastByte[0] !== 0x0a) separator = "\n";
        }
        await file.writeFile(`${separator}${JSON.stringify(record)}\n`, "utf8");
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError("backend.failed", { cause: error });
    }
  }

  async function readFile(session: SessionRef): Promise<string | undefined> {
    try {
      const sessionDirectory = await existingSessionDirectory(sessions, session);
      if (sessionDirectory === undefined) return undefined;
      const path = join(sessionDirectory, "practice-reads.jsonl");
      if (!(await assertPrivateFile(path))) return undefined;
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const details = await file.stat();
        if (
          !details.isFile() ||
          details.nlink !== 1 ||
          (process.platform !== "win32" &&
            (details.uid !== process.getuid?.() || (details.mode & 0o077) !== 0))
        ) {
          throw new BackendError("backend.state-invalid");
        }
        return await file.readFile("utf8");
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isMissing(error)) return undefined;
      if (error instanceof BackendError) throw error;
      throw new BackendError("backend.failed", { cause: error });
    }
  }

  const service: PracticeHintService = {
    async routeToolEvent(event) {
      sessions.routeToolEvent(event);
    },

    async recordSuccessfulGet(cwd, hint, session) {
      const parsed = successfulGetReportSchema.safeParse({
        cwd,
        hint,
        ...(session === undefined ? {} : { session }),
      });
      if (!parsed.success) throw new BackendError("backend.invalid-request");
      const reportTime = now();
      const workingDirectory = resolve(parsed.data.cwd);
      const associated = sessions.resolve(workingDirectory, parsed.data.session);
      if (associated === undefined) return;

      const record = persistedReadHintSchema.parse({
        ...associated,
        cwd: workingDirectory,
        readAt: new Date(reportTime).toISOString(),
        hint: parsed.data.hint,
      });
      await append(record);
    },

    async readRecentHints(hostKey, sessionId) {
      const parsed = readHintsQuerySchema.safeParse({ hostKey, sessionId });
      if (!parsed.success) throw new BackendError("backend.invalid-request");
      const contents = await readFile(parsed.data);
      if (contents === undefined) return [];

      const seen = new Set<string>();
      const hints: ReadHint[] = [];
      for (const line of contents.split("\n").reverse()) {
        if (line.length === 0) continue;
        try {
          const record: unknown = JSON.parse(line);
          const result = persistedReadHintSchema.safeParse(record);
          if (
            !result.success ||
            result.data.hostKey !== parsed.data.hostKey ||
            result.data.sessionId !== parsed.data.sessionId ||
            seen.has(result.data.hint.id)
          ) {
            continue;
          }
          seen.add(result.data.hint.id);
          const hint: ReadHint = {
            ...result.data.hint,
            title: result.data.hint.title.slice(0, 100),
            ...(result.data.hint.appliesWhen === undefined
              ? {}
              : { appliesWhen: result.data.hint.appliesWhen.slice(0, 120) }),
          };
          if (
            hints.length >= maxRecentHints ||
            Buffer.byteLength(JSON.stringify([...hints, hint]), "utf8") > MAX_RESPONSE_BYTES
          ) {
            break;
          }
          hints.push(hint);
        } catch {
          // A damaged or incomplete JSONL line does not hide prior complete records.
        }
      }
      return hints;
    },
  };
  return Object.freeze(service);
}
