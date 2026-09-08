/** The requested ID does not satisfy the shared Practice format rule. */
export class InvalidPracticeIdError extends Error {
  constructor() {
    super("Invalid Practice ID");
    this.name = "InvalidPracticeIdError";
  }
}

/** A Pack named in a mutation does not appear in the active manifest. */
export class PackNotInstalledError extends Error {
  constructor(readonly packName: string) {
    super(`Pack "${packName}" is not installed`);
    this.name = "PackNotInstalledError";
  }
}

/**
 * `install` was called for a pack name that is already active with a
 * different artifact digest — the caller must use `upgrade` instead
 * (ADR 0007 §7).
 */
export class UpgradeRequiredError extends Error {
  constructor(
    readonly packName: string,
    readonly activeArtifactDigest: string,
    readonly candidateArtifactDigest: string,
  ) {
    super(
      `Pack "${packName}" is installed with a different digest; use upgrade instead of install`,
    );
    this.name = "UpgradeRequiredError";
  }
}

/** A monotonic LocalStore counter cannot be incremented without losing precision. */
export class StoreCounterExhaustedError extends Error {
  constructor(readonly counter: "generation" | "effectiveRevision") {
    super(`LocalStore ${counter} reached Number.MAX_SAFE_INTEGER and cannot advance`);
    this.name = "StoreCounterExhaustedError";
  }
}

/** A query index was bound to a Store snapshot that is no longer current. */
export class StoreSnapshotChangedError extends Error {
  constructor() {
    super("LocalStore snapshot changed during query");
    this.name = "StoreSnapshotChangedError";
  }
}
