import { isAbsolute } from "node:path";
import { z } from "zod";

import {
  InvalidQueryRequestError,
  SemanticIndexIncompatibleError,
  SemanticIndexNotReadyError,
  StoreBusyError,
  parseQueryRequest,
  type StorageRoot,
} from "@lorelum/engine";
import { EmbeddingError } from "../modules/embedding/errors";

/** The locked Lorelum checkout binds this internal stdin/stdout protocol version. */
export const SEMANTIC_RETRIEVAL_HARNESS_PROTOCOL_VERSION = 1;

const MAX_QUERY_LIMIT = 50;
const requestSchema = z
  .strictObject({
    query: z.string(),
    storeRoot: z.string().min(1).refine(isAbsolute),
    embeddingProfileId: z.string().regex(/^[a-f0-9]{64}$/),
    candidateWidth: z.number().int().min(1).max(MAX_QUERY_LIMIT),
    resultLimit: z.number().int().min(1).max(MAX_QUERY_LIMIT),
  })
  .refine((request) => request.candidateWidth >= request.resultLimit);

export interface SemanticRetrievalHarnessRequest {
  readonly query: string;
  readonly storeRoot: string;
  readonly embeddingProfileId: string;
  readonly candidateWidth: number;
  readonly resultLimit: number;
}

export type SemanticRetrievalHarnessFailureCode =
  | "invalid_request"
  | "profile_mismatch"
  | "runtime_unavailable"
  | "index_unavailable"
  | "store_busy"
  | "retrieval_failed"
  | "invalid_result";

export type SemanticRetrievalHarnessResponse =
  | {
      readonly status: "ok";
      readonly candidateIds: readonly string[];
      readonly finalIds: readonly string[];
    }
  | {
      readonly status: "error";
      readonly errorCode: SemanticRetrievalHarnessFailureCode;
    };

export interface SemanticCandidateTrace {
  readonly candidateIds: readonly string[];
  readonly finalIds: readonly string[];
}

export interface SemanticRetrievalHarnessDependencies {
  readonly embeddingProfileId: string;
  query(
    root: StorageRoot,
    request: {
      readonly text: string;
      readonly candidateWidth: number;
      readonly resultLimit: number;
    },
  ): Promise<SemanticCandidateTrace>;
}

export type ParsedSemanticRetrievalHarnessRequest =
  | { readonly status: "valid"; readonly request: SemanticRetrievalHarnessRequest }
  | { readonly status: "invalid"; readonly response: SemanticRetrievalHarnessResponse };

function failure(errorCode: SemanticRetrievalHarnessFailureCode): SemanticRetrievalHarnessResponse {
  return Object.freeze({ status: "error", errorCode });
}

/** Parse one JSON request. The strict schema intentionally rejects labels and unknown fields. */
export function parseSemanticRetrievalHarnessRequest(
  input: string,
): ParsedSemanticRetrievalHarnessRequest {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return Object.freeze({ status: "invalid", response: failure("invalid_request") });
  }
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ status: "invalid", response: failure("invalid_request") });
  }
  try {
    const query = parseQueryRequest({ text: parsed.data.query, limit: parsed.data.resultLimit });
    return Object.freeze({
      status: "valid",
      request: Object.freeze({ ...parsed.data, query: query.text }),
    });
  } catch (error) {
    if (error instanceof InvalidQueryRequestError) {
      return Object.freeze({ status: "invalid", response: failure("invalid_request") });
    }
    throw error;
  }
}

function hasUniqueStringIds(ids: unknown): ids is readonly string[] {
  return (
    Array.isArray(ids) &&
    ids.every((id: unknown) => typeof id === "string" && id.length > 0) &&
    new Set(ids).size === ids.length
  );
}

function isValidTrace(
  value: unknown,
  request: SemanticRetrievalHarnessRequest,
): value is SemanticCandidateTrace {
  if (typeof value !== "object" || value === null) return false;
  const trace = value as Record<string, unknown>;
  const candidateIds = trace.candidateIds;
  const finalIds = trace.finalIds;
  if (!hasUniqueStringIds(candidateIds) || !hasUniqueStringIds(finalIds)) return false;
  return (
    candidateIds.length <= request.candidateWidth &&
    finalIds.length <= request.resultLimit &&
    finalIds.every((id) => candidateIds.includes(id))
  );
}

function queryFailureCode(error: unknown): SemanticRetrievalHarnessFailureCode {
  if (error instanceof StoreBusyError) return "store_busy";
  if (
    error instanceof SemanticIndexNotReadyError ||
    error instanceof SemanticIndexIncompatibleError
  )
    return "index_unavailable";
  if (error instanceof EmbeddingError) return "runtime_unavailable";
  if (error instanceof InvalidQueryRequestError) return "invalid_request";
  return "retrieval_failed";
}

/** Execute one validated request and return only IDs; errors never contain partial lists. */
export async function executeSemanticRetrievalHarnessRequest(
  request: SemanticRetrievalHarnessRequest,
  dependencies: SemanticRetrievalHarnessDependencies,
): Promise<SemanticRetrievalHarnessResponse> {
  if (request.embeddingProfileId !== dependencies.embeddingProfileId) {
    return failure("profile_mismatch");
  }
  try {
    const trace = await dependencies.query(
      Object.freeze({ rootPath: request.storeRoot }),
      Object.freeze({
        text: request.query,
        candidateWidth: request.candidateWidth,
        resultLimit: request.resultLimit,
      }),
    );
    if (!isValidTrace(trace, request)) return failure("invalid_result");
    return Object.freeze({
      status: "ok",
      candidateIds: Object.freeze([...trace.candidateIds]),
      finalIds: Object.freeze([...trace.finalIds]),
    });
  } catch (error) {
    return failure(queryFailureCode(error));
  }
}

export function serializeSemanticRetrievalHarnessResponse(
  response: SemanticRetrievalHarnessResponse,
): string {
  return JSON.stringify(response) + "\n";
}
