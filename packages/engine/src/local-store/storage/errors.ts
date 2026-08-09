/** A snapshot, manifest, or derived SQLite state violates LocalStore's storage contract. */
export class LocalStoreStorageError extends Error {
  constructor(
    message: string,
    readonly rootCause?: unknown,
  ) {
    super(message, rootCause === undefined ? undefined : { cause: rootCause });
    this.name = "LocalStoreStorageError";
  }
}

/**
 * An immutable snapshot is missing, altered, or cannot be promoted safely.
 * The path stays a structured field — the message stays generic so CLI/MCP
 * boundaries decide what to surface (paths may contain sensitive names).
 */
export class ArtifactIntegrityError extends LocalStoreStorageError {
  constructor(
    readonly artifactPath: string,
    message: string,
  ) {
    super("Artifact is invalid: " + message);
    this.name = "ArtifactIntegrityError";
  }
}

/** A Pack snapshot cannot be assembled into the public format input. */
export class SnapshotFormatError extends LocalStoreStorageError {
  constructor(
    readonly snapshotPath: string,
    message: string,
    cause?: unknown,
  ) {
    super("Pack snapshot is invalid: " + message, cause);
    this.name = "SnapshotFormatError";
  }
}

/** The active manifest is absent or structurally invalid. */
export class ManifestError extends LocalStoreStorageError {
  constructor(
    readonly manifestPath: string,
    message: string,
    cause?: unknown,
  ) {
    super("Installed-pack manifest is invalid: " + message, cause);
    this.name = "ManifestError";
  }
}

/** SQLite-derived LocalStore state cannot be decoded or does not meet its contract. */
export class SqliteStateError extends LocalStoreStorageError {
  constructor(message: string, cause?: unknown) {
    super("LocalStore SQLite state is invalid: " + message, cause);
    this.name = "SqliteStateError";
  }
}
