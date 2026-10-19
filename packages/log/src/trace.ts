import { DEFAULT_MAX_RECORDS, readManagedLogs } from "./reader.js";
import type { LogRecord } from "./record.js";
import type { TraceId } from "./context.js";

const correlationFields = ["requestId", "operationId", "preparationId", "nativeRunId"] as const;

type CorrelationField = (typeof correlationFields)[number];

export interface TraceLogCollection {
  readonly traceId: TraceId;
  /** Records explicitly emitted for this invocation. */
  readonly directRecords: readonly LogRecord[];
  /** Unattributed lifecycle records reached through a selected atomic ID. */
  readonly sharedRecords: readonly LogRecord[];
  readonly missing: readonly string[];
  readonly truncated: boolean;
}

export interface CollectTraceLogsOptions {
  readonly rootDirectory: string;
  readonly traceId: TraceId;
  /** Bounds both the direct result and the managed-root relation scan. */
  readonly limit?: number;
}

function relationKey(field: CorrelationField, value: string): string {
  return `${field}:${value}`;
}

function relationKeys(record: LogRecord): readonly string[] {
  return correlationFields.flatMap((field) => {
    const value = record[field];
    return value === undefined ? [] : [relationKey(field, value)];
  });
}

/**
 * Reads one trace from managed logs and follows only anonymous shared lifecycle
 * records by request/operation/preparation/native-run relation. A record owned
 * by another trace is intentionally never traversed or returned.
 */
export async function collectTraceLogs(
  options: CollectTraceLogsOptions,
): Promise<TraceLogCollection> {
  const limit = options.limit ?? DEFAULT_MAX_RECORDS;
  const directRecords: LogRecord[] = [];
  let directTruncated = false;
  const available = await readManagedLogs({
    rootDirectory: options.rootDirectory,
    limit,
    onRecord(record) {
      if (record.traceId !== options.traceId) return;
      directRecords.push(record);
      if (directRecords.length > limit) {
        directRecords.shift();
        directTruncated = true;
      }
    },
  });
  directRecords.sort((left, right) => left.time.localeCompare(right.time));
  const relations = new Set(directRecords.flatMap(relationKeys));
  const shared: LogRecord[] = [];
  const seen = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const record of available.records) {
      if (record.traceId !== undefined || !relationKeys(record).some((key) => relations.has(key))) {
        continue;
      }
      const identity = JSON.stringify(record);
      if (!seen.has(identity)) {
        seen.add(identity);
        shared.push(record);
      }
      for (const key of relationKeys(record)) {
        if (!relations.has(key)) {
          relations.add(key);
          changed = true;
        }
      }
    }
  }

  const missing = [
    ...available.missing,
    ...(directTruncated || available.truncated ? ["trace-log-collection-truncated"] : []),
  ];
  return {
    traceId: options.traceId,
    directRecords,
    sharedRecords: shared.sort((left, right) => left.time.localeCompare(right.time)),
    missing: [...new Set(missing)],
    truncated: directTruncated || available.truncated,
  };
}
