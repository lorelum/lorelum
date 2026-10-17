import { expect, test } from "bun:test";
import type { VectorRetrievalMethod } from "./methods/types";
import { resolveVectorRetrievalMethod } from "./methods/catalog";
import { createVectorExecution } from "./profile";

const encoding = { encodingId: "a".repeat(64), dimensions: 384 };

test("equivalent executions share a profile while different methods remain isolated", () => {
  const single = resolveVectorRetrievalMethod("single-vector");
  const multi = resolveVectorRetrievalMethod("multi-view-vector");
  const first = createVectorExecution(encoding, single);
  expect(first.method).toBe(single);
  expect(first.profile.profileId).toBe(createVectorExecution(encoding, single).profile.profileId);
  expect(first.profile.profileId).not.toBe(
    createVectorExecution(encoding, multi).profile.profileId,
  );
});

for (const version of ["documentVersion", "queryVersion", "scoringVersion"] as const) {
  test(`${version} changes invalidate the execution profile`, () => {
    const method = resolveVectorRetrievalMethod("multi-view-vector");
    const changed: VectorRetrievalMethod = {
      ...method,
      recipe: { ...method.recipe, [version]: method.recipe[version] + 1 },
    };
    expect(createVectorExecution(encoding, changed).profile.profileId).not.toBe(
      createVectorExecution(encoding, method).profile.profileId,
    );
  });
}

test("encoding identity and dimensions both bind the profile", () => {
  const method = resolveVectorRetrievalMethod("single-vector");
  const id = createVectorExecution(encoding, method).profile.profileId;
  expect(createVectorExecution({ ...encoding, dimensions: 2 }, method).profile.profileId).not.toBe(
    id,
  );
  expect(
    createVectorExecution({ ...encoding, encodingId: "b".repeat(64) }, method).profile.profileId,
  ).not.toBe(id);
});
