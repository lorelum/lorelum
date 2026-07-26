import type { ValidationReport } from "@lorelum/format";

export class LocalStoreError extends Error {
  override readonly name: string = "LocalStoreError";
}

export class PackValidationError extends LocalStoreError {
  override readonly name: string = "PackValidationError";

  constructor(readonly report: ValidationReport) {
    super("Pack validation failed");
  }
}

export class InvalidPreparedPackError extends LocalStoreError {
  override readonly name: string = "InvalidPreparedPackError";
}

export class PackUpgradeRequiredError extends LocalStoreError {
  override readonly name: string = "PackUpgradeRequiredError";

  constructor(readonly packName: string) {
    super(`Pack "${packName}" is already installed with different content; use upgrade`);
  }
}

export class PackNotInstalledError extends LocalStoreError {
  override readonly name: string = "PackNotInstalledError";

  constructor(readonly packName: string) {
    super(`Pack "${packName}" is not installed`);
  }
}

export class PracticeConflictError extends LocalStoreError {
  override readonly name: string = "PracticeConflictError";

  constructor(
    readonly practiceId: string,
    readonly candidatePackName: string,
    readonly activePackName: string,
  ) {
    super(
      `Practice "${practiceId}" from "${candidatePackName}" conflicts with active pack "${activePackName}"`,
    );
  }
}

export class StoreInvariantError extends LocalStoreError {
  override readonly name: string = "StoreInvariantError";
}

export class StoreBusyError extends LocalStoreError {
  override readonly name: string = "StoreBusyError";

  constructor(readonly lockPath: string) {
    super(`LocalStore is busy with another mutation at "${lockPath}"`);
  }
}
