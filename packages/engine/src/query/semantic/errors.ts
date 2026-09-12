/** A semantic-index invariant, SQLite operation, or embedding result failed. */
export class SemanticIndexError extends Error {
  constructor(message = "Semantic index operation failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "SemanticIndexError";
  }
}

/** The Store changed while a complete semantic index was being constructed. */
export class SemanticIndexSnapshotChangedError extends SemanticIndexError {
  constructor(options?: ErrorOptions) {
    super("LocalStore changed while semantic index was building", options);
    this.name = "SemanticIndexSnapshotChangedError";
  }
}

/** A configured embedding capability did not meet the fixed Profile contract. */
export class SemanticEmbeddingError extends SemanticIndexError {
  constructor(
    message = "Embedding result is incompatible with the semantic Profile",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SemanticEmbeddingError";
  }
}

/** The active semantic index is absent or cannot safely answer this query yet. */
export class SemanticIndexNotReadyError extends SemanticIndexError {
  constructor(message = "Semantic index is not ready", options?: ErrorOptions) {
    super(message, options);
    this.name = "SemanticIndexNotReadyError";
  }
}

/** The active semantic index belongs to another Store or Profile contract. */
export class SemanticIndexIncompatibleError extends SemanticIndexError {
  constructor(message = "Semantic index is incompatible", options?: ErrorOptions) {
    super(message, options);
    this.name = "SemanticIndexIncompatibleError";
  }
}

/** The active semantic index could not be read or its candidates failed validation. */
export class SemanticIndexQueryError extends SemanticIndexError {
  constructor(message = "Semantic index query failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "SemanticIndexQueryError";
  }
}
