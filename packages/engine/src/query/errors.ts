/** Thrown when a runtime Query request has no usable query text. */
export class InvalidQueryError extends Error {
  constructor() {
    super("The query must be a non-empty string.");
    this.name = "InvalidQueryError";
  }
}
