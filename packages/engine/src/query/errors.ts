/** Invalid domain input; adapters translate this without exposing the input text. */
export class InvalidQueryRequestError extends Error {
  constructor(message = "Invalid query request") {
    super(message);
    this.name = "InvalidQueryRequestError";
  }
}

/** Failure to build, search, or consume a keyword index. */
export class KeywordIndexError extends Error {
  constructor(message = "Keyword query failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "KeywordIndexError";
  }
}

/** The runtime does not provide SQLite FTS5. No alternate ranking is silently selected. */
export class KeywordIndexUnavailableError extends KeywordIndexError {
  constructor(options?: ErrorOptions) {
    super("SQLite FTS5 is unavailable in this runtime", options);
    this.name = "KeywordIndexUnavailableError";
  }
}
