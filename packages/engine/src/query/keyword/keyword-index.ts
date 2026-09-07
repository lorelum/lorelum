import { Database } from "bun:sqlite";

import { KeywordIndexError, KeywordIndexUnavailableError } from "../errors";
import { encodeKeywordMatch, tokenizeKeywordText } from "./tokenizer";
import type { KeywordDocument } from "./projection";

export interface KeywordCandidate {
  readonly practiceId: string;
  readonly contentDigest: string;
  /** Higher is better. This is a private adapter value, not a public Query score. */
  readonly score: number;
}

export interface KeywordIndex {
  search(text: string, limit: number): readonly KeywordCandidate[];
  close(): void;
}

const CREATE_KEYWORD_TABLE = `
  CREATE VIRTUAL TABLE keyword_documents USING fts5(
    practice_id UNINDEXED,
    content_digest UNINDEXED,
    id,
    title,
    applies_when,
    tech_stack,
    stage,
    anti_patterns,
    body,
    tokenize = 'unicode61 remove_diacritics 0'
  )
`;

const INSERT_DOCUMENT = `
  INSERT INTO keyword_documents (
    practice_id, content_digest, id, title, applies_when, tech_stack, stage, anti_patterns, body
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// FTS5 accepts a weight per table column. Identity and digest are UNINDEXED,
// then the seven searchable M1 fields use the fixed experimental weights.
/** M1's fixed experimental field weighting. It is intentionally not public configuration. */
const KEYWORD_FIELD_WEIGHTS = Object.freeze({
  id: 8,
  title: 5,
  appliesWhen: 3,
  techStack: 2,
  stage: 1,
  antiPatterns: 1,
  body: 1,
});

const FTS5_BM25_WEIGHTS = [
  0,
  0,
  KEYWORD_FIELD_WEIGHTS.id,
  KEYWORD_FIELD_WEIGHTS.title,
  KEYWORD_FIELD_WEIGHTS.appliesWhen,
  KEYWORD_FIELD_WEIGHTS.techStack,
  KEYWORD_FIELD_WEIGHTS.stage,
  KEYWORD_FIELD_WEIGHTS.antiPatterns,
  KEYWORD_FIELD_WEIGHTS.body,
].join(", ");

const SEARCH_DOCUMENTS = `
  SELECT
    practice_id,
    content_digest,
    bm25(keyword_documents, ${FTS5_BM25_WEIGHTS}) AS distance
  FROM keyword_documents
  WHERE keyword_documents MATCH ?
  ORDER BY distance ASC, practice_id ASC
  LIMIT ?
`;

function isFts5Unavailable(error: unknown): boolean {
  return error instanceof Error && /no such module:\s*fts5/i.test(error.message);
}

function asKeywordIndexError(message: string, error: unknown): KeywordIndexError {
  if (error instanceof KeywordIndexError) return error;
  if (isFts5Unavailable(error)) return new KeywordIndexUnavailableError({ cause: error });
  return new KeywordIndexError(message, { cause: error });
}

function tokenizeDocument(document: KeywordDocument): readonly string[] {
  return [
    document.practiceId,
    document.contentDigest,
    ...[
      document.id,
      document.title,
      document.appliesWhen,
      document.techStack,
      document.stage,
      document.antiPatterns,
      document.body,
    ].map((field) => tokenizeKeywordText(field).join(" ")),
  ];
}

function candidateFromRow(row: unknown): KeywordCandidate {
  if (typeof row !== "object" || row === null) {
    throw new KeywordIndexError("Keyword index returned a malformed candidate");
  }
  const value = row as Record<string, unknown>;
  if (
    typeof value.practice_id !== "string" ||
    typeof value.content_digest !== "string" ||
    typeof value.distance !== "number" ||
    !Number.isFinite(value.distance)
  ) {
    throw new KeywordIndexError("Keyword index returned a malformed candidate");
  }
  return Object.freeze({
    practiceId: value.practice_id,
    contentDigest: value.content_digest,
    score: -value.distance,
  });
}

/** Build a request-private FTS5 index. The caller owns the returned index. */
export function buildKeywordIndex(documents: readonly KeywordDocument[]): KeywordIndex {
  let database: Database | undefined;
  try {
    database = new Database(":memory:");
    database.exec(CREATE_KEYWORD_TABLE);
    const insertDocument = database.query(INSERT_DOCUMENT);
    database.transaction(() => {
      for (const document of documents) {
        insertDocument.run(...tokenizeDocument(document));
      }
    })();
    return createKeywordIndex(database);
  } catch (error) {
    try {
      database?.close();
    } catch {
      // The original build failure is the useful error for callers.
    }
    throw asKeywordIndexError("Cannot build SQLite keyword index", error);
  }
}

function createKeywordIndex(database: Database): KeywordIndex {
  let closed = false;
  const searchDocuments = database.query(SEARCH_DOCUMENTS);
  const requireOpen = (): void => {
    if (closed) throw new KeywordIndexError("Keyword index is closed");
  };
  return Object.freeze({
    search(text, limit) {
      requireOpen();
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new KeywordIndexError("Keyword result limit must be a positive safe integer");
      }
      const match = encodeKeywordMatch(tokenizeKeywordText(text));
      if (match === undefined) return Object.freeze([]);
      try {
        return Object.freeze(searchDocuments.all(match, limit).map(candidateFromRow));
      } catch (error) {
        throw asKeywordIndexError("Cannot search SQLite keyword index", error);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        database.close();
      } catch (error) {
        throw asKeywordIndexError("Cannot close SQLite keyword index", error);
      }
    },
  } satisfies KeywordIndex);
}
