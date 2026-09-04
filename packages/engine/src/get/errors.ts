/** Thrown when `get` resolves a Practice id that matches no effective Practice. */
export class UnknownPracticeError extends Error {
  constructor(practiceId: string) {
    super(`No effective Practice exists with id "${practiceId}".`);
    this.name = "UnknownPracticeError";
  }
}
