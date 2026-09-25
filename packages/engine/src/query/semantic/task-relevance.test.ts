import { expect, test } from "bun:test";

import type { EffectivePractice } from "../../local-store";
import { canonicalizePractice } from "../../local-store/model";
import { KeywordIndexUnavailableError } from "../errors";
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
  id: "react.server.request-dedup-cache",
  title: "Deduplicate Request-Scoped Work",
  stage: "server",
  techStack: ["react"],
  appliesWhen:
    "one server render calls the same request-scoped async work, such as session or record lookup, from more than one component or helper",
  body: "Share one cached result for the request instead of repeating the lookup.",
});

const postPractice = practice({
  id: "issue-pr-etiquette.pull-request.write-the-pr-body-for-a-cold-reviewer",
  title: "Write the PR Body for a Cold Reviewer",
  stage: "pull-request",
  techStack: ["git"],
  appliesWhen:
    "a PR is about to be opened, and the author must write a body from which a reviewer with none of the author's context can verify the change",
  body: "State the problem, the decision and the evidence in the post itself.",
});

const request =
  "I am opening a PR that fixes a React cache bug; a reviewer will see it without our chat history, so make the context self-contained.";

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

test("keeps the semantic order when the runtime has no SQLite FTS5", () => {
  const candidates = [
    candidate(domainPractice.practiceId, 0.9),
    candidate(postPractice.practiceId, 0.88),
  ];
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: request,
    candidates,
    practices: [domainPractice, postPractice],
    signal: {
      measure() {
        throw new KeywordIndexUnavailableError();
      },
    },
  });
  expect(ordered).toEqual(candidates);
});

test("prefers the stage named by the request when one domain has several moments", () => {
  const reviewFinding = practice({
    id: "agentic-coding.review.validate-findings-before-action",
    title: "Validate Findings Before Action",
    stage: "review",
    techStack: ["typescript"],
    appliesWhen:
      "a human, agent, analyzer, or review has raised a finding, and the agent is about to change the current artifact without first establishing whether the finding is true and in scope",
  });
  const verification = practice({
    id: "agentic-coding.verification.map-evidence-to-acceptance",
    title: "Map Evidence to Acceptance",
    stage: "verification",
    techStack: ["typescript"],
    appliesWhen:
      "implementation is ready for verification, actual checks or observations are available, and the agent is about to decide whether the accepted behavior is covered",
  });
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: "A review comment says the migration is unsafe; check the claim against the code and tests before changing anything.",
    candidates: [
      candidate(verification.practiceId, 0.9),
      candidate(reviewFinding.practiceId, 0.88),
    ],
    practices: [reviewFinding, verification],
  });
  expect(ids(ordered)).toEqual([reviewFinding.practiceId, verification.practiceId]);
});

test("keeps a domain Practice first when the request is actually about that domain", () => {
  const ordered = orderSemanticCandidatesByTaskRelevance({
    text: "The server render calls the same request-scoped async work twice, so deduplicate it.",
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
