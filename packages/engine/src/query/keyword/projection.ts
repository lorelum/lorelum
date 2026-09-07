import type { EffectivePractice } from "../../local-store";

/** The complete, request-local text representation passed to the keyword index. */
export interface KeywordDocument {
  readonly practiceId: string;
  readonly contentDigest: string;
  readonly id: string;
  readonly title: string;
  readonly appliesWhen: string;
  readonly techStack: string;
  readonly stage: string;
  readonly antiPatterns: string;
  readonly body: string;
}

/**
 * Project one canonical Effective Practice into the seven M1 keyword fields.
 * This deliberately does not serialize an anti-pattern's reserved `check`
 * value: it has no stable format and is not part of searchable guidance yet.
 */
export function projectKeywordPractice(effective: EffectivePractice): KeywordDocument {
  const { practice } = effective;
  return Object.freeze({
    practiceId: effective.practiceId,
    contentDigest: effective.contentDigest,
    id: practice.id,
    title: practice.title,
    appliesWhen: practice.applies_when,
    techStack: practice.tech_stack.join(" "),
    stage: practice.stage,
    antiPatterns:
      practice.anti_patterns
        ?.map((antiPattern) =>
          [antiPattern.id, antiPattern.name, antiPattern.description].join(" "),
        )
        .join("\n") ?? "",
    body: practice.body ?? "",
  });
}
