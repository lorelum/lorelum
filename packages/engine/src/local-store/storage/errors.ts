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

/** An immutable snapshot is missing, altered, or cannot be promoted safely. */
export class ArtifactIntegrityError extends LocalStoreStorageError {
  constructor(
    readonly artifactPath: string,
    message: string,
  ) {
    super('Artifact at "' + artifactPath + '" is invalid: ' + message);
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
    super('Pack snapshot at "' + snapshotPath + '" is invalid: ' + message, cause);
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
    super('Installed-pack manifest at "' + manifestPath + '" is invalid: ' + message, cause);
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
