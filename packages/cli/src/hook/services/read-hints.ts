import type { ReadHint } from "@lorelum/backend/client";
import { renderReadHints } from "../../practice-hints/render.js";
import type { ReadHintReader } from "../types.js";

/** Preserve the supplied client's optional-request and diagnostic policy. */
export function createReadHintReader(hints: {
  readRecentHints(hostKey: string, sessionId: string): Promise<readonly ReadHint[]>;
}): ReadHintReader {
  return {
    async readHintContext(session) {
      return renderReadHints(await hints.readRecentHints(session.hostKey, session.sessionId));
    },
  };
}
