/**
 * @lorelum/engine LocalStore — the stable public surface (ADR 0007 §13).
 * Only the LocalStore facade, result types, and typed errors are exported;
 * internal directories stay private to the package.
 */

export {
  createLocalStore,
  defaultStorageRoot,
  type LocalStore,
  type OpenResult,
  type StorageRoot,
} from "./lifecycle/local-store";

export {
  decodeSnapshot as decodePackDirectory,
  defaultPackDirectoryLimits,
  type DecodedSnapshot as DecodedPackDirectory,
  type PackDirectoryLimits,
} from "./storage/artifacts/snapshot-codec";

export type {
  InstallResult,
  MutationResultBase,
  ReindexResult,
  UninstallResult,
} from "./lifecycle/types";

export type { EffectiveRevisionHook } from "./lifecycle/types";

export {
  PackNotInstalledError,
  StoreCounterExhaustedError,
  UpgradeRequiredError,
} from "./lifecycle/errors";

export {
  PackValidationError,
  PracticeConflictError,
  InvalidSourcePathError,
  InvalidPracticeSourceError,
} from "./model/errors";

export { SnapshotFormatError, StoreBusyError, StoreRecoveryRequiredError } from "./storage/errors";

export type {
  PackCandidate,
  EffectivePractice,
  RevisionDelta,
  PracticeSource,
} from "./model/types";

export { isPracticeSourcePath } from "./model/candidate";
