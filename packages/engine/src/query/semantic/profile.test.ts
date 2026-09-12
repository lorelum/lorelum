import { expect, test } from "bun:test";

import { createEmbeddingProfile } from "./profile";

test("preserves the persisted Profile identity shape", () => {
  const profile = createEmbeddingProfile({
    encodingId: "a".repeat(64),
    dimensions: 384,
  });

  expect(profile.profileId).toBe(
    "5e4266c4f7b1240288d84df6cf089c14590ab1ed5401e55ae3ebdb3928614f14",
  );
});
