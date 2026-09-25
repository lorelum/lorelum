export {
  allowsLogLevel,
  createTraceId,
  isCredentialKey,
  isLogLevel,
  isTraceId,
  logLevels,
  pickCorrelation,
  requireTraceId,
  sanitizeLogContext,
  type LogContext,
  type LogCorrelation,
  type LogLevel,
  type TraceId,
} from "./context.js";
export {
  createLogRecord,
  DEFAULT_LOG_RECORD_BYTES,
  serializeError,
  serializeLogRecord,
  type LogEventInput,
  type LogRecord,
  type SerializedError,
} from "./record.js";
export { createLogger, type CreateLoggerOptions, type Logger } from "./logger.js";
export {
  FanoutLogSink,
  FilteredLogEmitter,
  MemoryLogSink,
  noopEmitter,
  SinkLogEmitter,
  TraceDetailLogEmitter,
  withDiagnosticLevel,
  type LogEmitter,
  type LogSink,
} from "./sink.js";
export { JsonlFileSink, type JsonlFileSinkOutcome } from "./sinks/jsonl.js";
export {
  evaluateManagedTarget,
  hasCode,
  inspectAndTightenDirectory,
  inspectAndTightenExistingFile,
  inspectAndTightenHandle,
  ManagedLogLocationError,
  walkManagedLocation,
  type EvaluateManagedTargetOptions,
  type InspectResult,
  type ManagedLogLocationFailure,
  type ManagedRepairFact,
  type ManagedTargetFacts,
  type ManagedTargetKind,
  type ManagedTargetVerdict,
  type UnsafeTargetReason,
  type WalkManagedLocationOptions,
} from "./sinks/safety.js";
export {
  pruneManagedLogs,
  readManagedLogs,
  type LocatedLogRecord,
  type ManagedLogReadResult,
  type ManagedLogRoot,
  type ManagedRootAvailability,
  type PruneManagedLogsOptions,
  type PruneManagedLogsResult,
  type ReadManagedLogsOptions,
} from "./reader.js";
export {
  collectTraceLogs,
  type CollectTraceLogsOptions,
  type TraceLogCollection,
} from "./trace.js";
export {
  deriveTraceEvidenceState,
  persistenceRecordInput,
  PERSISTENCE_MESSAGE,
  type PersistenceFailureFact,
  type PersistenceOutcomeFact,
  type PersistenceRepairFact,
  type TraceEvidenceInput,
  type TraceEvidenceState,
  type TraceEvidenceStatus,
} from "./evidence.js";
