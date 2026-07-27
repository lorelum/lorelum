import type { ValidationReport } from "@lorelum/format";

/** A candidate Pack failed the author-facing format validation gate. */
export class PackValidationError extends Error {
  constructor(readonly report: ValidationReport) {
    super("Pack failed format validation");
    this.name = "PackValidationError";
  }
}

/** A candidate attempts to replace a globally stable Practice id with different content. */
export class PracticeConflictError extends Error {
  constructor(
    readonly practiceId: string,
    readonly candidatePackName: string,
    readonly conflictingPackName: string,
  ) {
    super(
      `Practice "${practiceId}" from pack "${candidatePackName}" conflicts with active pack "${conflictingPackName}"`,
    );
    this.name = "PracticeConflictError";
  }
}

/** Candidate source metadata violates LocalStore's Pack-root path contract. */
export class InvalidSourcePathError extends Error {
  constructor(
    readonly practiceId: string,
    readonly sourcePath: string,
  ) {
    super(`Practice "${practiceId}" has invalid source path "${sourcePath}"`);
    this.name = "InvalidSourcePathError";
  }
}

/** A source passed back from storage does not match its canonical metadata. */
export class InvalidPracticeSourceError extends Error {
  constructor(
    readonly practiceId: string,
    readonly reason: string,
  ) {
    super(`Practice source "${practiceId}" is invalid: ${reason}`);
    this.name = "InvalidPracticeSourceError";
  }
}
