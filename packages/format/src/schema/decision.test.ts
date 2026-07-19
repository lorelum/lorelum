import { describe, expect, test } from "bun:test";

import { DecisionNodeSchema } from "./decision";

const clientVsServer = {
  id: "state.client-vs-server",
  question: "How much client state?",
  branches: [
    {
      when: "heavy client state",
      recommend: ["react.state.redux"],
      reason: "Redux scales for heavy state",
      next: "state.persistence-choice",
    },
  ],
};

describe("DecisionNodeSchema", () => {
  test("accepts a node with a next edge", () => {
    expect(DecisionNodeSchema.safeParse(clientVsServer).success).toBe(true);
  });

  test("accepts a branch without next", () => {
    const r = DecisionNodeSchema.safeParse({
      id: "state.client-vs-server",
      question: "How much client state?",
      branches: [{ when: "x", recommend: ["react.state.redux"], reason: "y" }],
    });
    expect(r.success).toBe(true);
  });

  test("rejects missing branches", () => {
    expect(
      DecisionNodeSchema.safeParse({ id: "state.client-vs-server", question: "q" }).success,
    ).toBe(false);
  });

  test("rejects a branch missing recommend", () => {
    const branchWithoutRecommend = { when: "x", reason: "y", next: "state.persistence-choice" };
    expect(
      DecisionNodeSchema.safeParse({ ...clientVsServer, branches: [branchWithoutRecommend] })
        .success,
    ).toBe(false);
  });
});
