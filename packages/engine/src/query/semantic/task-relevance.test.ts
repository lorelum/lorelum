import { expect, test } from "bun:test";

import type { EffectivePractice } from "../../local-store";
import { canonicalizePractice } from "../../local-store/model";
import { KeywordIndexUnavailableError } from "../errors";
import { SemanticIndexQueryError } from "./errors";
import type { SemanticCandidate } from "./index/reader";
import {
  SEMANTIC_TASK_SIGNAL_WEIGHT,
  canonicalPracticeTaskSignal,
  orderSemanticCandidatesByTaskRelevance,
  type SemanticTaskSignal,
} from "./task-relevance";

interface PracticeInput {
  readonly id: string;
  readonly title: string;
  readonly stage: string;
  readonly techStack: readonly string[];
  readonly appliesWhen: string;
  readonly body?: string;
}

function practice(input: PracticeInput): EffectivePractice {
  const canonical = canonicalizePractice({
    id: input.id,
    title: input.title,
    stage: input.stage,
    tech_stack: [...input.techStack],
    applies_when: input.appliesWhen,
    ...(input.body === undefined ? {} : { body: input.body }),
    severity: "warn",
  });
  return { practiceId: input.id, ...canonical, sources: [] };
}

function candidate(practiceId: string, similarity: number): SemanticCandidate {
  return Object.freeze({ practiceId, contentDigest: "0".repeat(64), similarity });
}

function ids(candidates: readonly SemanticCandidate[]): readonly string[] {
  return candidates.map((item) => item.practiceId);
}

const noSignal: SemanticTaskSignal = Object.freeze({
  measure: () => new Map<string, number>(),
});

const domainPractice = practice({
  id: "sample.throughput",
  title: "Measure throughput",
  stage: "performance",
  techStack: ["database"],
  appliesWhen: "Measure throughput during sustained traffic.",
});
const postPractice = practice({
  id: "sample.rollback",
  title: "Audit rollback",
  stage: "review",
  techStack: ["database"],
  appliesWhen: "Audit rollback before approving deployment.",
});
const request = "Audit rollback";

test("keeps the semantic order when no Practice shares a term with the request", () => {
  const candidates = [candidate("platform.beta", 0.9), candidate("platform.alpha", 0.8)];
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: "unrelated request",
    candidates,
    practices: [],
    signal: noSignal,
  });
  expect(ordered).toEqual(candidates);
});

test("promotes the Practice whose stated moment matches the request over a nearer domain match", () => {
  const candidates = [
    candidate(domainPractice.practiceId, 0.9),
    candidate(postPractice.practiceId, 0.88),
  ];
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: request,
    candidates,
    practices: [domainPractice, postPractice],
  });
  expect(ids(ordered)).toEqual([postPractice.practiceId, domainPractice.practiceId]);
});

test("keeps a clear semantic winner ahead of a weaker task match", () => {
  const candidates = [
    candidate(domainPractice.practiceId, 0.97),
    candidate(postPractice.practiceId, 0.88),
  ];
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: request,
    candidates,
    practices: [domainPractice, postPractice],
  });
  expect(ids(ordered)).toEqual([domainPractice.practiceId, postPractice.practiceId]);
});

test("bounds the task adjustment by the declared weight", () => {
  const justInside = [
    candidate("platform.domain", 0.9),
    candidate("platform.task", 0.9 - SEMANTIC_TASK_SIGNAL_WEIGHT + 0.001),
  ];
  const signal: SemanticTaskSignal = Object.freeze({
    measure: () =>
      new Map([
        ["platform.domain", 0],
        ["platform.task", 1],
      ]),
  });
  expect(
    ids(
      orderSemanticCandidatesByTaskRelevance({
        text: "request",
        candidates: justInside,
        practices: [],
        signal,
      }),
    ),
  ).toEqual(["platform.task", "platform.domain"]);

  const justOutside = [
    candidate("platform.domain", 0.9),
    candidate("platform.task", 0.9 - SEMANTIC_TASK_SIGNAL_WEIGHT - 0.001),
  ];
  expect(
    ids(
      orderSemanticCandidatesByTaskRelevance({
        text: "request",
        candidates: justOutside,
        practices: [],
        signal,
      }),
    ),
  ).toEqual(["platform.domain", "platform.task"]);
});

test("orders equal relevance deterministically by Practice ID", () => {
  const candidates = [candidate("platform.beta", 0.8), candidate("platform.alpha", 0.8)];
  const signal: SemanticTaskSignal = Object.freeze({
    measure: () => new Map([["platform.alpha", 1]]),
  });
  expect(
    ids(
      orderSemanticCandidatesByTaskRelevance({
        text: "request",
        candidates,
        practices: [],
        signal: {
          measure: () =>
            new Map([
              ["platform.alpha", 0],
              ["platform.beta", 0],
            ]),
        },
      }),
    ),
  ).toEqual(["platform.alpha", "platform.beta"]);
  expect(
    ids(
      orderSemanticCandidatesByTaskRelevance({
        text: "request",
        candidates: [...candidates].reverse(),
        practices: [],
        signal,
      }),
    ),
  ).toEqual(["platform.alpha", "platform.beta"]);
});

test("reports unavailable task scoring as a semantic query failure", () => {
  expect(() =>
    orderSemanticCandidatesByTaskRelevance({
      text: request,
      candidates: [
        candidate(domainPractice.practiceId, 0.9),
        candidate(postPractice.practiceId, 0.88),
      ],
      practices: [domainPractice, postPractice],
      signal: {
        measure() {
          throw new KeywordIndexUnavailableError();
        },
      },
    }),
  ).toThrow(SemanticIndexQueryError);
});

test("prefers the matching stage among synthetic Practices about one domain", () => {
  const verify = practice({
    id: "sample.verification",
    title: "Verify outcomes",
    stage: "verification",
    techStack: ["database"],
    appliesWhen: "Verify outcomes after deployment.",
  });
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: request,
    candidates: [candidate(verify.practiceId, 0.9), candidate(postPractice.practiceId, 0.88)],
    practices: [verify, postPractice],
  });
  expect(ids(ordered)).toEqual([postPractice.practiceId, verify.practiceId]);
});

test("keeps a domain Practice first when the request is actually about that domain", () => {
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: "Measure throughput",
    candidates: [
      candidate(postPractice.practiceId, 0.9),
      candidate(domainPractice.practiceId, 0.88),
    ],
    practices: [domainPractice, postPractice],
  });
  expect(ids(ordered)).toEqual([domainPractice.practiceId, postPractice.practiceId]);
});

test("measures the task signal from canonical Practice fields", () => {
  const strength = canonicalPracticeTaskSignal.measure({
    text: request,
    practices: [domainPractice, postPractice],
  });
  expect(strength.size).toBeGreaterThan(0);
  for (const value of strength.values()) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
  expect(strength.get(postPractice.practiceId) ?? 0).toBeGreaterThan(
    strength.get(domainPractice.practiceId) ?? 0,
  );
  expect(canonicalPracticeTaskSignal.measure({ text: request, practices: [] }).size).toBe(0);
});

function synthetic(id: string, title: string, body = ""): EffectivePractice {
  return practice({ id, title, body, stage: "engineering", techStack: [], appliesWhen: "" });
}

test("a pronoun cannot match a fragment of a technical compound", () => {
  const debugging = synthetic(
    "sample.debugging",
    "Diagnose failures",
    "Debugging unexplained defects",
  );
  const storage = synthetic("sample.storage", "Storage throughput", "Profile I/O latency");
  const candidates = Object.freeze([
    candidate(debugging.practiceId, 0.84),
    candidate(storage.practiceId, 0.83),
  ]);
  const strength = canonicalPracticeTaskSignal.measure({
    text: "I investigate unexpected behavior",
    practices: [debugging, storage],
  });
  expect(strength.get(storage.practiceId) ?? 0).toBe(0);
  expect(
    ids(
      orderSemanticCandidatesByTaskRelevance({
        text: "I investigate unexpected behavior",
        candidates,
        practices: [debugging, storage],
      }),
    ),
  ).toEqual(ids(candidates));
  expect(
    ids(
      orderSemanticCandidatesByTaskRelevance({
        text: "I/O throughput",
        candidates,
        practices: [debugging, storage],
      }),
    )[0],
  ).toBe(storage.practiceId);
});

test("nearly equal lexical evidence cannot amplify a tiny length difference into a maximum bonus gap", () => {
  const left = synthetic("sample.left", "Checkpoint", "padding ".repeat(100));
  const right = synthetic("sample.right", "Checkpoint", "padding ".repeat(101));
  const ps = [left, right];
  const strength = canonicalPracticeTaskSignal.measure({ text: "checkpoint", practices: ps });
  expect(Math.abs(strength.get(left.practiceId)! - strength.get(right.practiceId)!)).toBeLessThan(
    0.01,
  );
  const candidates = Object.freeze([
    candidate(right.practiceId, 0.845),
    candidate(left.practiceId, 0.84),
  ]);
  expect(
    ids(orderSemanticCandidatesByTaskRelevance({ text: "checkpoint", candidates, practices: ps })),
  ).toEqual(ids(candidates));
});

test("an isolated matching word cannot receive the full bonus", () => {
  const match = synthetic("sample.marker", "Checkpoint");
  const other = synthetic("sample.other", "Dashboard");
  const strength = canonicalPracticeTaskSignal.measure({
    text: "checkpoint telemetry rollback",
    practices: [match, other],
  });
  expect(strength.get(match.practiceId)).toBeGreaterThan(0);
  expect(strength.get(match.practiceId)).toBeLessThanOrEqual(0.5);
  expect(strength.has(other.practiceId)).toBe(false);
});

test("function-word-only and cross-language non-overlap queries add no lexical evidence", () => {
  const ps = [
    synthetic("sample.first", "This is a dashboard"),
    synthetic("sample.second", "I/O throughput"),
  ];
  for (const text of ["I am in the", "调查异常行为"]) {
    expect(canonicalPracticeTaskSignal.measure({ text, practices: ps }).size).toBe(0);
  }
});

test("unmatched background cannot dilute existing lexical evidence", () => {
  const match = synthetic("sample.marker", "Checkpoint");
  const other = synthetic("sample.other", "Dashboard");
  const short = canonicalPracticeTaskSignal.measure({
    text: "checkpoint",
    practices: [match, other],
  });
  const verbose = canonicalPracticeTaskSignal.measure({
    text: "checkpoint telemetry rollback observability",
    practices: [match, other],
  });
  expect(verbose.get(match.practiceId)).toBe(short.get(match.practiceId));
  expect(short.get(match.practiceId)).toBeLessThanOrEqual(0.5);
});
