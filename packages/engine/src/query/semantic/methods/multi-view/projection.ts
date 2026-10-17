import type { EffectivePractice } from "../../../../local-store";
import type { EmbeddingInput, PracticeVectorProjection } from "../../representation";
import type { VectorMethodRecipe } from "../types";
import { createEmbeddingInput, createPracticeVectorProjection } from "../../projection-identity";

/**
 * Views are cut by an estimated token budget, not by a character count: a
 * character budget silently truncates at the model context about four times
 * sooner for CJK text than for Latin text. The estimate is intentionally
 * conservative because the Engine has no tokenizer of its own.
 */
export const SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS = 384;

interface MarkdownUnit {
  readonly headingPath: readonly string[];
  readonly text: string;
}

type ProjectionPractice = EffectivePractice["practice"];

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;

/** Conservative token estimate: CJK ideographs and kana cost about one token each. */
export function estimatedTokens(text: string): number {
  let tokens = 0;
  for (const character of text) tokens += CJK.test(character) ? 1 : 0.25;
  return tokens;
}

function joinNonEmpty(values: readonly string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function antiPatternTriggers(practice: ProjectionPractice): string {
  return (
    practice.anti_patterns
      // The anti-pattern id is a slug: embedding it would smuggle a lexical anchor in.
      ?.map((antiPattern) => [antiPattern.name, antiPattern.description].join("\n"))
      .join("\n\n") ?? ""
  );
}

/**
 * The schema-backed "when does this apply" text. Field labels and the tech
 * stack are deliberately absent: labels add English scaffolding to non-English
 * content, and domain nouns must not decide an applicability question.
 */
function taskCardText(practice: ProjectionPractice): string {
  return joinNonEmpty([
    practice.title,
    practice.applies_when,
    practice.stage,
    antiPatternTriggers(practice),
  ]);
}

/**
 * The whole Practice as one context anchor, including the tech stack and the
 * full body. It carries no ids or labels; long text is split by token budget so
 * a single over-long input cannot exceed the model context.
 */
function fullText(practice: ProjectionPractice): string {
  return joinNonEmpty([
    practice.title,
    practice.applies_when,
    practice.stage,
    practice.tech_stack.map((entry) => entry.trim()).join(", "),
    antiPatternTriggers(practice),
    practice.body ?? "",
  ]);
}

function markdownUnits(body: string): readonly MarkdownUnit[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const headingPath: string[] = [];
  const current: string[] = [];
  const units: MarkdownUnit[] = [];
  const flush = () => {
    const text = current.join("\n").trim();
    current.length = 0;
    if (text.length > 0) units.push(Object.freeze({ headingPath: [...headingPath], text }));
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      flush();
      const level = heading[1]!.length;
      headingPath.splice(level - 1);
      headingPath.push(heading[2]!.trim());
      continue;
    }
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return Object.freeze(units);
}

function hardSplit(text: string, maximum: number): readonly string[] {
  const chunks: string[] = [];
  let buffer = "";
  for (const character of text) {
    if (buffer.trim().length > 0 && estimatedTokens(`${buffer}${character}`) > maximum) {
      chunks.push(buffer.trim());
      buffer = "";
    }
    buffer += character;
  }
  if (buffer.trim().length > 0) chunks.push(buffer.trim());
  return Object.freeze(chunks);
}

function splitByTokenBudget(text: string, maximum: number): readonly string[] {
  const whole = text.trim();
  if (estimatedTokens(whole) <= maximum) {
    return Object.freeze(whole.length > 0 ? [whole] : []);
  }
  // CJK sentences end with their own punctuation and need no trailing whitespace.
  const sentences = text
    .split(/(?<=[.!?\u3002\uFF01\uFF1F])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    const value = current.trim();
    current = "";
    if (value.length > 0) chunks.push(value);
  };

  for (const sentence of sentences) {
    if (estimatedTokens(sentence) > maximum) {
      push();
      chunks.push(...hardSplit(sentence, maximum));
      continue;
    }
    const next = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (estimatedTokens(next) > maximum) {
      push();
      current = sentence;
    } else {
      current = next;
    }
  }
  push();
  return Object.freeze(chunks);
}

/**
 * Heading context for one body unit, capped at `maximum` estimated tokens. The
 * deepest headings are the most specific, so ancestors are dropped first; a
 * single heading longer than the cap keeps only its first budget-sized piece.
 */
function headingPrefix(headingPath: readonly string[], maximum: number): string {
  const segments = [...headingPath];
  while (segments.length > 1 && estimatedTokens(segments.join(" > ")) > maximum) segments.shift();
  const heading = segments.join(" > ");
  return estimatedTokens(heading) > maximum ? (hardSplit(heading, maximum)[0] ?? "") : heading;
}

function bodyChunkTexts(body: string): readonly string[] {
  const chunks: string[] = [];
  for (const unit of markdownUnits(body)) {
    // Heading context takes at most half the budget. Token estimates are additive,
    // so prefix + part stays within SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS.
    const heading = headingPrefix(unit.headingPath, SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS / 2);
    const prefix = heading.length === 0 ? "" : `${heading}\n\n`;
    const budget = SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS - estimatedTokens(prefix);
    for (const part of splitByTokenBudget(unit.text, budget)) {
      chunks.push(`${prefix}${part}`);
    }
  }
  return Object.freeze(chunks);
}

/**
 * Deterministic representation-group projection. The Store remains canonical;
 * this is derived state that a Profile/index version change can rebuild.
 */
export function projectMultiViewDocument(
  effective: EffectivePractice,
  recipe: VectorMethodRecipe,
): PracticeVectorProjection {
  const inputs: EmbeddingInput[] = [];
  const add = (channel: string, texts: readonly string[]): void => {
    for (const [ordinal, text] of texts.entries()) {
      inputs.push(createEmbeddingInput(recipe, channel, ordinal, text));
    }
  };
  add("full", splitByTokenBudget(fullText(effective.practice), SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS));
  add(
    "task-card",
    splitByTokenBudget(taskCardText(effective.practice), SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS),
  );
  add("body", bodyChunkTexts(effective.practice.body ?? ""));
  return createPracticeVectorProjection(effective, recipe, inputs);
}
