import { expect, test } from "bun:test";

import { evaluateDecisions } from "./evaluate.js";

test("uses the first matching branch in declaration order", () => {
  const result = evaluateDecisions({
    context: { state: { client: "heavy" } },
    decisions: [
      {
        branches: [
          {
            reason: "The specific branch wins",
            recommend: ["test.specific"],
            when: 'state.client == "heavy"',
          },
          {
            reason: "This is never reached",
            recommend: ["test.fallback"],
            when: 'state.client == "heavy"',
          },
        ],
        id: "test.entry",
        question: "Which recommendation applies?",
      },
    ],
    entryDecision: "test.entry",
  });

  expect(result).toEqual({
    entryDecision: "test.entry",
    recommendations: [{ practiceId: "test.specific", reasons: ["The specific branch wins"] }],
    status: "matched",
    trace: [
      {
        decisionId: "test.entry",
        matchedWhen: 'state.client == "heavy"',
        nextDecision: null,
        question: "Which recommendation applies?",
      },
    ],
  });
});

test("accumulates chain recommendations while preserving first occurrence order and reasons", () => {
  const result = evaluateDecisions({
    context: { state: { client: "heavy", persistence: true } },
    decisions: [
      {
        branches: [
          {
            next: "test.persistence",
            reason: "Complex client state needs a predictable store",
            recommend: ["test.store"],
            when: 'state.client == "heavy"',
          },
        ],
        id: "test.entry",
        question: "How much client state?",
      },
      {
        branches: [
          {
            reason: "Persisted state needs a recovery policy",
            recommend: ["test.store", "test.persistence"],
            when: "state.persistence == true",
          },
        ],
        id: "test.persistence",
        question: "Does state persist?",
      },
    ],
    entryDecision: "test.entry",
  });

  expect(result).toEqual({
    entryDecision: "test.entry",
    recommendations: [
      {
        practiceId: "test.store",
        reasons: [
          "Complex client state needs a predictable store",
          "Persisted state needs a recovery policy",
        ],
      },
      { practiceId: "test.persistence", reasons: ["Persisted state needs a recovery policy"] },
    ],
    status: "matched",
    trace: [
      {
        decisionId: "test.entry",
        matchedWhen: 'state.client == "heavy"',
        nextDecision: "test.persistence",
        question: "How much client state?",
      },
      {
        decisionId: "test.persistence",
        matchedWhen: "state.persistence == true",
        nextDecision: null,
        question: "Does state persist?",
      },
    ],
  });
});

test("returns no_match with the final decision trace for an unmatched or missing context", () => {
  const input = {
    decisions: [
      {
        branches: [
          { reason: "Heavy state", recommend: ["test.store"], when: 'state.client == "heavy"' },
        ],
        id: "test.entry",
        question: "How much client state?",
      },
    ],
    entryDecision: "test.entry",
  };

  expect(evaluateDecisions({ ...input, context: { state: { client: "light" } } })).toMatchObject({
    noMatchReason: "no branch matched the provided context",
    recommendations: [],
    status: "no_match",
    trace: [expect.objectContaining({ matchedWhen: null, nextDecision: null })],
  });
  expect(evaluateDecisions({ ...input, context: {} }).status).toBe("no_match");
});

test("returns no_match when the pack has no decisions", () => {
  expect(evaluateDecisions({ context: {}, decisions: [], entryDecision: "test.entry" })).toEqual({
    entryDecision: "test.entry",
    noMatchReason: "pack has no decisions",
    recommendations: [],
    status: "no_match",
    trace: [],
  });
});

test("deduplicates repeated recommendations within one branch", () => {
  const result = evaluateDecisions({
    context: { enabled: true },
    decisions: [
      {
        branches: [
          {
            reason: "One reason",
            recommend: ["test.store", "test.store"],
            when: "enabled",
          },
        ],
        id: "test.entry",
        question: "What now?",
      },
    ],
    entryDecision: "test.entry",
  });

  expect(result).toMatchObject({
    recommendations: [{ practiceId: "test.store", reasons: ["One reason"] }],
    status: "matched",
  });
});

test("returns typed errors for an unknown entry, malformed condition, and a runtime cycle", () => {
  expect(() =>
    evaluateDecisions({
      context: {},
      decisions: [{ branches: [], id: "test.other", question: "What now?" }],
      entryDecision: "test.entry",
    }),
  ).toThrow(expect.objectContaining({ code: "decide.unknown_decision" }));
  expect(() =>
    evaluateDecisions({
      context: {},
      decisions: [
        {
          branches: [{ reason: "Invalid", recommend: [], when: "state.client = heavy" }],
          id: "test.entry",
          question: "What now?",
        },
      ],
      entryDecision: "test.entry",
    }),
  ).toThrow(expect.objectContaining({ code: "decide.invalid_condition" }));
  expect(() =>
    evaluateDecisions({
      context: { enabled: true },
      decisions: [
        {
          branches: [{ next: "test.loop", reason: "Loop", recommend: [], when: "enabled" }],
          id: "test.entry",
          question: "Start?",
        },
        {
          branches: [{ next: "test.entry", reason: "Loop", recommend: [], when: "enabled" }],
          id: "test.loop",
          question: "Continue?",
        },
      ],
      entryDecision: "test.entry",
    }),
  ).toThrow(expect.objectContaining({ code: "decide.cycle" }));
});

test("rejects an invalid condition in a later branch even when an earlier branch matches", () => {
  expect(() =>
    evaluateDecisions({
      context: { enabled: true },
      decisions: [
        {
          branches: [
            { reason: "First branch matches", recommend: [], when: "enabled" },
            { reason: "Invalid syntax", recommend: [], when: "state.client = heavy" },
          ],
          id: "test.entry",
          question: "What now?",
        },
      ],
      entryDecision: "test.entry",
    }),
  ).toThrow(expect.objectContaining({ code: "decide.invalid_condition" }));
});

test("rejects duplicate decision ids before evaluation", () => {
  expect(() =>
    evaluateDecisions({
      context: {},
      decisions: [
        { branches: [], id: "test.entry", question: "What now?" },
        { branches: [], id: "test.entry", question: "Ambiguous duplicate?" },
      ],
      entryDecision: "test.entry",
    }),
  ).toThrow(expect.objectContaining({ code: "decide.duplicate_decision" }));
});

test("maps an over-deep condition to a typed invalid-condition error", () => {
  expect(() =>
    evaluateDecisions({
      context: {},
      decisions: [
        {
          branches: [
            {
              reason: "Too deep",
              recommend: [],
              when: "(".repeat(129) + "true" + ")".repeat(129),
            },
          ],
          id: "test.entry",
          question: "What now?",
        },
      ],
      entryDecision: "test.entry",
    }),
  ).toThrow(expect.objectContaining({ code: "decide.invalid_condition" }));
});
