import {
  readManagedLogs,
  type LocatedLogRecord,
  type ManagedLogRoot,
  type ManagedRootAvailability,
  type ManagedLogReadResult,
} from "./reader.js";
import type { LogRecord } from "./record.js";
import type { TraceId } from "./context.js";

const correlationFields = ["requestId", "operationId", "preparationId", "nativeRunId"] as const;

type CorrelationField = (typeof correlationFields)[number];

export interface TraceLogCollection {
  readonly traceId: TraceId;
  /** Records explicitly emitted for this invocation. */
  readonly directRecords: readonly LogRecord[];
  /** Aligned with `directRecords`; states which designed root held each one. */
  readonly directLocations: readonly ManagedLogRoot[];
  /** Unattributed lifecycle records reached through a selected atomic ID. */
  readonly sharedRecords: readonly LogRecord[];
  /** Aligned with `sharedRecords`. */
  readonly sharedLocations: readonly ManagedLogRoot[];
  readonly missing: readonly string[];
  readonly truncated: boolean;
  readonly rootAvailability: readonly ManagedRootAvailability[];
}

export interface CollectTraceLogsOptions {
  readonly rootDirectory: string;
  readonly fallbackRootDirectory?: string;
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

function mergeMissing(...results: readonly ManagedLogReadResult[]): readonly string[] {
  return [...new Set(results.flatMap((result) => result.missing))];
}

/**
 * Reads one trace from managed logs and follows only anonymous shared lifecycle
 * records by request/operation/preparation/native-run relation. A record owned
 * by another trace is intentionally never traversed or returned.
 */
export async function collectTraceLogs(
  options: CollectTraceLogsOptions,
): Promise<TraceLogCollection> {
  const sharedOptions = {
    rootDirectory: options.rootDirectory,
    ...(options.fallbackRootDirectory === undefined
      ? {}
      : { fallbackRootDirectory: options.fallbackRootDirectory }),
  };
  const [direct, available] = await Promise.all([
    readManagedLogs({
      ...sharedOptions,
      traceId: options.traceId,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }),
    readManagedLogs({
      ...sharedOptions,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }),
  ]);
  const relations = new Set(direct.records.flatMap(relationKeys));
  const shared: LocatedLogRecord[] = [];
  const seen = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (let index = 0; index < available.records.length; index += 1) {
      const record = available.records[index]!;
      if (record.traceId !== undefined || !relationKeys(record).some((key) => relations.has(key))) {
        continue;
      }
      const identity = JSON.stringify(record);
      if (!seen.has(identity)) {
        seen.add(identity);
        shared.push({ record, root: available.locations[index] ?? "primary" });
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
    ...mergeMissing(direct, available),
    ...(direct.truncated || available.truncated ? ["trace-log-collection-truncated"] : []),
  ];
  const sortedShared = shared.sort((left, right) =>
    left.record.time.localeCompare(right.record.time),
  );
  return {
    traceId: options.traceId,
    directRecords: direct.records,
    directLocations: direct.locations,
    sharedRecords: sortedShared.map((entry) => entry.record),
    sharedLocations: sortedShared.map((entry) => entry.root),
    missing: [...new Set(missing)],
    truncated: direct.truncated || available.truncated,
    rootAvailability: direct.rootAvailability,
  };
}
