import type { Practice } from "@lorelum/format";

import { deepFreeze } from "./freeze";
import type { CanonicalPractice, PracticeSnapshot } from "./types";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

type ReadonlyPractice = {
  readonly id: string;
  readonly title: string;
  readonly stage: string;
  readonly tech_stack: readonly string[];
  readonly applies_when: string;
  readonly severity?: Practice["severity"] | undefined;
  readonly body?: string | undefined;
  readonly anti_patterns?:
    | readonly Readonly<NonNullable<Practice["anti_patterns"]>[number]>[]
    | undefined;
};

function snapshotPractice(practice: ReadonlyPractice): PracticeSnapshot {
  const canonical = canonicalPracticeObject(practice);
  const snapshot = structuredClone(canonical) as Practice;
  return deepFreeze(snapshot) as PracticeSnapshot;
}

function canonicalPracticeObject(practice: ReadonlyPractice): object {
  return {
    id: normalizeLineEndings(practice.id),
    title: normalizeLineEndings(practice.title),
    stage: normalizeLineEndings(practice.stage),
    tech_stack: practice.tech_stack.map(normalizeLineEndings),
    applies_when: normalizeLineEndings(practice.applies_when),
    severity: practice.severity ?? "warn",
    body: normalizeLineEndings(practice.body ?? ""),
    anti_patterns: (practice.anti_patterns ?? []).map((antiPattern) => ({
      id: normalizeLineEndings(antiPattern.id),
      name: normalizeLineEndings(antiPattern.name),
      description: normalizeLineEndings(antiPattern.description),
      severity: antiPattern.severity ?? "warn",
    })),
  };
}

/**
 * Build the ADR 0007 canonical JSON and SHA-256 digest for one Practice.
 * The object literal fixes key order; author-provided array order is retained.
 */
export function canonicalizePractice(practice: ReadonlyPractice): CanonicalPractice {
  const canonicalObject = canonicalPracticeObject(practice);
  const canonicalContent = JSON.stringify(canonicalObject);
  const contentDigest = new Bun.CryptoHasher("sha256").update(canonicalContent).digest("hex");
  return Object.freeze({ practice: snapshotPractice(practice), canonicalContent, contentDigest });
}
