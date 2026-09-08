/**
 * Internal-only logical work counters for the mutation benchmark.
 *
 * This deliberately is not part of the LocalStore facade or a CLI result. The
 * observer is threaded through lifecycle internals so tests and the compiled
 * benchmark can measure bounded projection work without exposing SQLite
 * handles or implementation counters to consumers.
 */
export type MutationMetricTable =
  | "local_store_metadata"
  | "active_packs"
  | "practice_sources"
  | "effective_practices"
  | "effective_revision_outbox"
  | "effective_revision_log";

export interface MutationMetricsObserver {
  recordRead(table: MutationMetricTable, rows: number): void;
  recordWrite(table: MutationMetricTable, rows: number): void;
  recordMaterialization(effectivePractices: number, sourceRows: number): void;
}

export interface MutationMetrics extends MutationMetricsObserver {
  snapshot(): MutationMetricsSnapshot;
}

export interface MutationMetricsSnapshot {
  readonly reads: Readonly<Record<MutationMetricTable, number>>;
  readonly writes: Readonly<Record<MutationMetricTable, number>>;
  readonly materializedEffectivePractices: number;
  readonly materializedSourceRows: number;
}

const TABLES: readonly MutationMetricTable[] = [
  "local_store_metadata",
  "active_packs",
  "practice_sources",
  "effective_practices",
  "effective_revision_outbox",
  "effective_revision_log",
];

function emptyCounts(): Record<MutationMetricTable, number> {
  return Object.fromEntries(TABLES.map((table) => [table, 0])) as Record<
    MutationMetricTable,
    number
  >;
}

/** Create an internal logical-work collector for one lifecycle operation. */
export function createMutationMetrics(): MutationMetrics {
  const reads = emptyCounts();
  const writes = emptyCounts();
  let materializedEffectivePractices = 0;
  let materializedSourceRows = 0;
  const snapshot = (): MutationMetricsSnapshot =>
    Object.freeze({
      reads: Object.freeze({ ...reads }),
      writes: Object.freeze({ ...writes }),
      materializedEffectivePractices,
      materializedSourceRows,
    });
  return {
    recordRead(table, rows) {
      if (!Number.isSafeInteger(rows) || rows < 0) throw new RangeError("invalid read count");
      reads[table] += rows;
    },
    recordWrite(table, rows) {
      if (!Number.isSafeInteger(rows) || rows < 0) throw new RangeError("invalid write count");
      writes[table] += rows;
    },
    recordMaterialization(effectivePractices, sourceRows) {
      if (
        !Number.isSafeInteger(effectivePractices) ||
        effectivePractices < 0 ||
        !Number.isSafeInteger(sourceRows) ||
        sourceRows < 0
      ) {
        throw new RangeError("invalid materialization count");
      }
      materializedEffectivePractices += effectivePractices;
      materializedSourceRows += sourceRows;
    },
    snapshot,
  };
}
