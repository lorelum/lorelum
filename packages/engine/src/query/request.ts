import { InvalidQueryRequestError } from "./errors";
import type { QueryRequest } from "./types";

// Query-domain defaults live here, not in CLI/MCP adapters.
const DEFAULT_QUERY_LIMIT = 5;
const MAX_QUERY_LIMIT = 50;
const MAX_QUERY_CODE_POINTS = 4_096;

/** Validate before Store I/O; length is measured after trim in Unicode code points. */
export function parseQueryRequest(request: QueryRequest): Required<QueryRequest> {
  if (typeof request !== "object" || request === null || typeof request.text !== "string") {
    throw new InvalidQueryRequestError("Query text must be a string");
  }
  const text = request.text.trim();
  if (text.length === 0) throw new InvalidQueryRequestError("Query text must not be blank");
  if (text.length > MAX_QUERY_CODE_POINTS * 2 || Array.from(text).length > MAX_QUERY_CODE_POINTS) {
    throw new InvalidQueryRequestError(
      `Query text exceeds ${MAX_QUERY_CODE_POINTS} Unicode code points`,
    );
  }
  const limit = request.limit === undefined ? DEFAULT_QUERY_LIMIT : request.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw new InvalidQueryRequestError(
      `Query limit must be an integer from 1 through ${MAX_QUERY_LIMIT}`,
    );
  }
  return Object.freeze({ text, limit });
}
