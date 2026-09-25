import { describe, expect, test } from "bun:test";

import { createLogRecord } from "./record.js";
import {
  deriveTraceEvidenceState,
  persistenceRecordInput,
  PERSISTENCE_MESSAGE,
} from "./evidence.js";
import type { TraceLogCollection } from "./trace.js";
import type { LogRecord } from "./record.js";
import type { TraceId } from "./context.js";

const traceId = "00000000-0000-4000-8000-000000000301" as never as TraceId;

function collection(overrides: Partial<TraceLogCollection> = {}): TraceLogCollection {
  return {
    traceId,
    directRecords: [],
    directLocations: [],
    sharedRecords: [],
    sharedLocations: [],
    missing: [],
    truncated: false,
    rootAvailability: [{ root: "primary" as const, state: "available" as const }],
    ...overrides,
  };
}

function persistenceRecord(persisted: boolean): LogRecord {
  return createLogRecord(
    persistenceRecordInput(traceId, "cli", {
      persisted,
      fallbackUsed: false,
      attemptedPath: "/home/.lorelum/logs/cli/2026-09-23/t.jsonl",
      usedPath: "/home/.lorelum/logs/cli/2026-09-23/t.jsonl",
    }),
  );
}

describe("deriveTraceEvidenceState", () => {
  test("available when the trace has persisted records, labeled by root", () => {
    const record = createLogRecord({
      level: "info",
      source: "cli.query",
      message: "completed",
      traceId,
    });
    const state = deriveTraceEvidenceState(
      collection({ directRecords: [record], directLocations: ["fallback"] }),
    );
    expect(state.status).toBe("available");
    expect(state.roots).toEqual(["fallback"]);
    expect(state.missingEvidence).toEqual([]);
  });

  test("not-persisted only when an outcome record says evidence was not persisted", () => {
    const state = deriveTraceEvidenceState(
      collection({ directRecords: [persistenceRecord(false)] }),
    );
    expect(state.status).toBe("not-persisted");
    expect(state.missingEvidence).toContain("evidence-not-persisted");
  });

  test("an unknown trace is not misreported as a write failure", () => {
    const state = deriveTraceEvidenceState(collection());
    expect(state.status).toBe("no-matching-records");
    expect(state.missingEvidence).toEqual(["no-matching-records"]);
  });

  test("unreadable when every existing root is unreadable or files cannot be read", () => {
    const allRootsUnavailable = collection({
      rootAvailability: [{ root: "primary", state: "unavailable" }],
      missing: ["log-root-unavailable"],
    });
    expect(deriveTraceEvidenceState(allRootsUnavailable).status).toBe("unreadable");

    const unreadableFiles = collection({
      missing: ["log-file-unreadable:cli/2026-09-23/t.jsonl"],
    });
    expect(deriveTraceEvidenceState(unreadableFiles).status).toBe("unreadable");
  });

  test("a missing fallback root does not make readable evidence unreadable", () => {
    const state = deriveTraceEvidenceState(
      collection({
        rootAvailability: [
          { root: "primary", state: "missing" },
          { root: "fallback", state: "missing" },
        ],
        missing: ["log-files-missing"],
      }),
    );
    expect(state.status).toBe("no-matching-records");
  });

  test("an unreadable primary stays unreadable even when the fallback is readable", () => {
    const state = deriveTraceEvidenceState(
      collection({
        rootAvailability: [
          { root: "primary", state: "unavailable" },
          { root: "fallback", state: "available" },
        ],
        missing: ["log-root-unavailable"],
      }),
    );
    expect(state.status).toBe("unreadable");
  });

  test("truncated when nothing survived the read bound", () => {
    const state = deriveTraceEvidenceState(collection({ truncated: true }));
    expect(state.status).toBe("truncated");
  });

  test("persistence outcome records are not counted as trace evidence", () => {
    const state = deriveTraceEvidenceState(
      collection({ directRecords: [persistenceRecord(true)] }),
    );
    expect(state.status).toBe("no-matching-records");
  });
});

test("persistence records carry the outcome fact in context", () => {
  const record = persistenceRecord(false);
  expect(record.message).toBe(PERSISTENCE_MESSAGE);
  expect(record.context).toMatchObject({ persisted: false, fallbackUsed: false });
});
