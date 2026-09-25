import {
  defaultDiagnosticsFallbackDirectory,
  defaultLogDirectory,
  loadLoggingSettings,
  resolveLorelumPaths,
} from "@lorelum/config";
import {
  createLogger,
  FanoutLogSink,
  FilteredLogEmitter,
  JsonlFileSink,
  ManagedLogLocationError,
  persistenceRecordInput,
  pruneManagedLogs,
  SinkLogEmitter,
  type Logger as LocalLogger,
  type LogEmitter,
  type PersistenceFailureFact,
  type PersistenceOutcomeFact,
  type PersistenceRepairFact,
  type TraceId,
} from "@lorelum/log";
import { dirname, join } from "node:path";

import { CliStderrLogSink } from "../runtime/diagnostics.js";
import { Logger } from "../runtime/logger.js";

export interface ProcessLogRuntime {
  readonly logger: Logger;
  readonly log: LocalLogger;
  readonly diagnostics: LogEmitter;
  readonly logDirectory: string;
  /**
   * Deviation facts known at initialization (repair, fallback, or no usable
   * location). Success envelopes render before `flush()`, so they report this;
   * `persistenceOutcome()` carries the final post-flush facts.
   */
  readonly initialPersistence?: PersistenceOutcomeFact;
  /** Final deviation facts; `undefined` on the quiet normal path. Valid after `flush()`. */
  persistenceOutcome(): PersistenceOutcomeFact | undefined;
  flush(): Promise<void>;
}

/** Test-only override for the designed fallback root; production derives it from home. */
export interface ProcessLogRuntimeOptions {
  readonly debug: boolean;
  readonly source?: "cli" | "hook";
  readonly host?: string;
  readonly rootDirectory?: string;
  readonly fallbackRootDirectory?: string;
  readonly persist?: boolean;
}

function daySegment(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function logFile(root: string, source: "cli" | "hook", traceId: TraceId, host?: string): string {
  return source === "hook"
    ? join(root, "hooks", host ?? "unknown", daySegment(), `${traceId}.jsonl`)
    : join(root, "cli", daySegment(), `${traceId}.jsonl`);
}

async function configuredLevel(debug: boolean): Promise<"error" | "warn" | "info" | "debug"> {
  if (debug) return "debug";
  try {
    return (await loadLoggingSettings()).level;
  } catch {
    // A malformed optional logging section must not prevent normal CLI recovery.
    return "info";
  }
}

function failureFrom(error: unknown, path: string): PersistenceFailureFact {
  if (error instanceof ManagedLogLocationError) {
    return { kind: "location-unavailable", reason: error.reason, path };
  }
  return { kind: "location-error", path, error: String(error) };
}

function mergeRepairs(
  ...groups: readonly (readonly PersistenceRepairFact[] | undefined)[]
): readonly PersistenceRepairFact[] {
  const seen = new Set<string>();
  const merged: PersistenceRepairFact[] = [];
  for (const group of groups) {
    for (const repair of group ?? []) {
      const identity = `${repair.kind}:${repair.path}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push(repair);
    }
  }
  return merged;
}

/**
 * Builds a persistent process-owned logger without changing stderr
 * presentation semantics. The managed location is selected once at
 * initialization: self-healed primary, then the designed private fallback;
 * a location that fails later keeps the historical disable semantics and is
 * never switched mid-invocation.
 */
export async function createProcessLogRuntime(
  stderr: { write(message: string): void },
  traceId: TraceId,
  options: ProcessLogRuntimeOptions = { debug: false },
): Promise<ProcessLogRuntime> {
  const source = options.source ?? "cli";
  const level = await configuredLevel(options.debug);
  const rootDirectory = options.rootDirectory ?? defaultLogDirectory();
  const fallbackRootDirectory =
    options.fallbackRootDirectory ??
    (options.rootDirectory === undefined ? defaultDiagnosticsFallbackDirectory() : undefined);
  const trustedDirectory =
    options.rootDirectory === undefined ? resolveLorelumPaths().rootDirectory : rootDirectory;
  const recordSource = source === "hook" ? `hook.${options.host ?? "unknown"}` : "cli";

  let activeSink: JsonlFileSink | undefined;
  let primaryFailure: PersistenceFailureFact | undefined;
  let primaryRepairFacts: readonly PersistenceRepairFact[] | undefined;
  let fallbackUsed = false;
  let fallbackAttemptPath: string | undefined;
  const attemptedPath = logFile(rootDirectory, source, traceId, options.host);

  if (options.persist !== false) {
    const primarySink = new JsonlFileSink(attemptedPath, rootDirectory, trustedDirectory);
    const primaryUsable = await primarySink.preflight().then(
      () => true,
      (error: unknown) => {
        primaryFailure = failureFrom(error, attemptedPath);
        // Repairs performed before the failing segment still happened.
        return false;
      },
    );
    let selected: JsonlFileSink | undefined = primaryUsable ? primarySink : undefined;
    if (!primaryUsable) {
      primaryRepairFacts = [...primarySink.outcome.repairs];
      if (fallbackRootDirectory !== undefined) {
        const fallbackPath = logFile(fallbackRootDirectory, source, traceId, options.host);
        fallbackAttemptPath = fallbackPath;
        const fallbackSink = new JsonlFileSink(
          fallbackPath,
          fallbackRootDirectory,
          dirname(fallbackRootDirectory),
        );
        const fallbackUsable = await fallbackSink.preflight().then(
          () => true,
          () => false,
        );
        if (fallbackUsable) {
          selected = fallbackSink;
          fallbackUsed = true;
        }
      }
    }
    activeSink = selected;
  }

  const stderrLogger = new Logger(stderr);
  const diagnostics = new FilteredLogEmitter(
    level,
    new SinkLogEmitter(
      new FanoutLogSink([
        ...(activeSink === undefined ? [] : [activeSink]),
        new CliStderrLogSink(stderrLogger),
      ]),
    ),
  );
  const log = createLogger({
    source: recordSource,
    level,
    context: { traceId },
    sinks: activeSink === undefined ? [] : [activeSink],
  });
  if (activeSink !== undefined) {
    void pruneManagedLogs({
      rootDirectory,
      ...(fallbackRootDirectory === undefined ? {} : { fallbackRootDirectory }),
    }).catch(() => undefined);
  }

  let recordedPersistence: PersistenceOutcomeFact | undefined;

  const initialRepairs =
    activeSink === undefined ? [] : mergeRepairs(primaryRepairFacts, activeSink.outcome.repairs);
  const initialPersistence: PersistenceOutcomeFact | undefined =
    options.persist === false
      ? undefined
      : activeSink === undefined
        ? {
            persisted: false,
            fallbackUsed: false,
            attemptedPath,
            usedPath: attemptedPath,
            ...(fallbackAttemptPath === undefined ? {} : { fallbackAttemptPath }),
            ...(primaryFailure === undefined ? {} : { failure: primaryFailure }),
          }
        : fallbackUsed || initialRepairs.length > 0
          ? {
              persisted: true,
              fallbackUsed,
              attemptedPath,
              usedPath: activeSink.path,
              ...(fallbackAttemptPath === undefined ? {} : { fallbackAttemptPath }),
              ...(primaryFailure === undefined ? {} : { failure: primaryFailure }),
              ...(initialRepairs.length === 0 ? {} : { repairs: initialRepairs }),
            }
          : undefined;

  const buildOutcome = (): PersistenceOutcomeFact | undefined => {
    if (options.persist === false) return undefined;
    const sink = activeSink;
    const primaryFailureFact = primaryFailure;
    if (sink === undefined) {
      return {
        persisted: false,
        fallbackUsed: false,
        attemptedPath,
        usedPath: attemptedPath,
        ...(fallbackAttemptPath === undefined ? {} : { fallbackAttemptPath }),
        ...(primaryFailureFact === undefined ? {} : { failure: primaryFailureFact }),
      };
    }
    const outcome = sink.outcome;
    const repairs = mergeRepairs(primaryRepairFacts, outcome.repairs);
    const deviated =
      fallbackUsed ||
      repairs.length > 0 ||
      outcome.status === "unavailable" ||
      outcome.status === "write-failed";
    if (!deviated) return undefined;
    // A primary failure explains fallback usage; otherwise a later sink
    // failure (if any) is the explaining fact.
    const failure = primaryFailureFact !== undefined ? primaryFailureFact : outcome.failure;
    return {
      persisted: outcome.status === "ready",
      fallbackUsed,
      attemptedPath,
      usedPath: sink.path,
      ...(fallbackAttemptPath === undefined ? {} : { fallbackAttemptPath }),
      ...(failure === undefined ? {} : { failure }),
      ...(repairs.length === 0 ? {} : { repairs }),
    };
  };

  return {
    logger: stderrLogger,
    log,
    diagnostics,
    logDirectory: rootDirectory,
    ...(initialPersistence === undefined ? {} : { initialPersistence }),
    persistenceOutcome: () => recordedPersistence,
    flush: async () => {
      const sink = activeSink;
      if (sink === undefined) {
        recordedPersistence = buildOutcome();
        return;
      }
      await sink.close();
      const outcome = sink.outcome;
      const fact = buildOutcome();
      if (fact !== undefined && outcome.status !== "unavailable") {
        // Best-effort append through the same sink so later readers can tell
        // "not persisted" apart from "no matching records".
        await sink.write(persistenceRecordInput(traceId, recordSource, fact));
        await sink.close();
      }
      recordedPersistence = fact;
    },
  };
}
