import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SEMANTIC_RETRIEVAL_HARNESS_PROTOCOL_VERSION,
  executeSemanticRetrievalHarnessRequest,
  parseSemanticRetrievalHarnessRequest,
  serializeSemanticRetrievalHarnessResponse,
} from "./semantic-retrieval-protocol";

const profileId = "a".repeat(64);
const validInput = {
  query: "  inspect the retrieval boundary  ",
  storeRoot: join(tmpdir(), "lorelum-benchmark-owned-store"),
  embeddingProfileId: profileId,
  candidateWidth: 20,
  resultLimit: 5,
};

function input(value: unknown = validInput): string {
  return JSON.stringify(value);
}

test("pins the harness protocol version used by benchmark provenance", () => {
  expect(SEMANTIC_RETRIEVAL_HARNESS_PROTOCOL_VERSION).toBe(1);
});

test("accepts a fixed Store, Profile and explicit N/K request", () => {
  const parsed = parseSemanticRetrievalHarnessRequest(input());
  expect(parsed).toEqual({
    status: "valid",
    request: { ...validInput, query: "inspect the retrieval boundary" },
  });
});

test("rejects malformed input, labels and invalid N/K without leaking fields", () => {
  for (const value of [
    "not json",
    input({ ...validInput, goldLabels: { core: ["secret"] } }),
    input({ ...validInput, candidateWidth: 4, resultLimit: 5 }),
    input({ ...validInput, storeRoot: "relative-store" }),
  ]) {
    const parsed = parseSemanticRetrievalHarnessRequest(value);
    expect(parsed).toMatchObject({
      status: "invalid",
      response: { status: "error", errorCode: "invalid_request" },
    });
    expect(JSON.stringify(parsed)).not.toContain("secret");
  }
});

test("returns only status and ID lists for one successful trace", async () => {
  let observed: unknown;
  const parsed = parseSemanticRetrievalHarnessRequest(input());
  if (parsed.status !== "valid") throw new Error("Expected a valid harness request");
  const response = await executeSemanticRetrievalHarnessRequest(parsed.request, {
    embeddingProfileId: profileId,
    async query(root, request) {
      observed = { root, request };
      return { candidateIds: ["core.practice", "support.practice"], finalIds: ["core.practice"] };
    },
  });

  expect(observed).toEqual({
    root: { rootPath: validInput.storeRoot },
    request: {
      text: "inspect the retrieval boundary",
      candidateWidth: 20,
      resultLimit: 5,
    },
  });
  expect(response).toEqual({
    status: "ok",
    candidateIds: ["core.practice", "support.practice"],
    finalIds: ["core.practice"],
  });
  expect(Object.keys(response).sort()).toEqual(["candidateIds", "finalIds", "status"]);
  const wire = serializeSemanticRetrievalHarnessResponse(response);
  expect(wire.endsWith("\n")).toBe(true);
  expect(wire).not.toContain("inspect the retrieval boundary");
  expect(wire).not.toMatch(/body|score|similarity|query/i);
});

test("rejects a mismatched runtime Profile before running retrieval", async () => {
  const parsed = parseSemanticRetrievalHarnessRequest(input());
  if (parsed.status !== "valid") throw new Error("Expected a valid harness request");
  let queries = 0;
  const response = await executeSemanticRetrievalHarnessRequest(parsed.request, {
    embeddingProfileId: "b".repeat(64),
    async query() {
      queries += 1;
      return { candidateIds: [], finalIds: [] };
    },
  });
  expect(response).toEqual({ status: "error", errorCode: "profile_mismatch" });
  expect(queries).toBe(0);
});

test("query failures do not return partial candidate or final ID lists", async () => {
  const parsed = parseSemanticRetrievalHarnessRequest(input());
  if (parsed.status !== "valid") throw new Error("Expected a valid harness request");
  const response = await executeSemanticRetrievalHarnessRequest(parsed.request, {
    embeddingProfileId: profileId,
    async query() {
      throw new Error("private query text and internal score");
    },
  });
  expect(response).toEqual({ status: "error", errorCode: "retrieval_failed" });
  expect(JSON.stringify(response)).not.toMatch(/candidateIds|finalIds|private query|score/i);
});

test("rejects duplicate IDs and final IDs outside the candidate pool", async () => {
  const parsed = parseSemanticRetrievalHarnessRequest(input());
  if (parsed.status !== "valid") throw new Error("Expected a valid harness request");
  const responses = await Promise.all(
    [
      { candidateIds: ["same", "same"], finalIds: ["same"] },
      { candidateIds: ["candidate"], finalIds: ["outside"] },
    ].map((trace) =>
      executeSemanticRetrievalHarnessRequest(parsed.request, {
        embeddingProfileId: profileId,
        async query() {
          return trace;
        },
      }),
    ),
  );
  for (const response of responses) {
    expect(response).toEqual({ status: "error", errorCode: "invalid_result" });
  }
});
