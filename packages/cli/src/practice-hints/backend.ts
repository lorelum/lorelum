import type {
  BackendClient,
  BackendRequestOptions,
  ReadHint,
  SessionRef,
  ShellToolEvent,
} from "@lorelum/backend/client";
import { sessionRefSchema } from "@lorelum/backend/client";

import { createProcessBackendClient } from "../model/commands.js";

const reportDeadlineMs = 350;

type HintClient = Pick<BackendClient, "routeToolEvent" | "recordSuccessfulGet" | "readRecentHints">;

function sessionRefFromEnvironment(): SessionRef | undefined {
  const result = sessionRefSchema.safeParse({
    hostKey: process.env.LORELUM_HOST_KEY,
    sessionId: process.env.LORELUM_HOST_SESSION_ID,
  });
  return result.success ? result.data : undefined;
}

async function optionalRequest<T>(
  connect: () => Promise<HintClient>,
  request: (client: HintClient, options: BackendRequestOptions) => Promise<T>,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  const deadline = Date.now() + reportDeadlineMs;
  const timeout = setTimeout(() => controller.abort(), reportDeadlineMs);
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
        once: true,
      });
    });
    const operation = async () => {
      const client = await connect();
      controller.signal.throwIfAborted();
      return request(client, { deadline, signal: controller.signal });
    };
    return await Promise.race([operation(), aborted]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

/** Optional hints never start the Backend or change the host command's result. */
export function createOptionalPracticeHints(
  connect: () => Promise<HintClient> = createProcessBackendClient,
) {
  return {
    async routeToolEvent(event: ShellToolEvent): Promise<void> {
      if (event.toolKind !== "shell") return;
      await optionalRequest(
        connect,
        (client, options) => client.routeToolEvent(event, options),
        undefined,
      );
    },
    async recordSuccessfulGet(cwd: string, hint: ReadHint): Promise<void> {
      const session = sessionRefFromEnvironment();
      await optionalRequest(
        connect,
        (client, options) => client.recordSuccessfulGet(cwd, hint, session, options),
        undefined,
      );
    },
    async readRecentHints(hostKey: string, sessionId: string): Promise<readonly ReadHint[]> {
      return optionalRequest(
        connect,
        (client, options) => client.readRecentHints(hostKey, sessionId, options),
        [],
      );
    },
  };
}

export const defaultPracticeHints = createOptionalPracticeHints();
