import { tokenizeKeywordText } from "../keyword/tokenizer";

// Only semantic request-local scoring uses this conservative English closed class.
// Negation, actions, question words and standalone technical letters are retained.
const FUNCTION_WORDS = new Set(
  (
    "a an the i me my we us our you your he him his she her it its they them their " +
    "this that these those am is are was were be been being have has had do does did " +
    "and or of to in on at by for from with as"
  ).split(" "),
);

// Keep slash-separated names and symbolic language suffixes as whole terms.
// In particular, an ordinary pronoun must not match a fragment of an I/O path.
const TECHNICAL_COMPOUND =
  /[\p{L}\p{N}]+(?:\+\+|#)?(?:\/[\p{L}\p{N}]+(?:\+\+|#)?)+|[\p{L}\p{N}]+(?:\+\+|#)/gu;
const utf8 = new TextEncoder();

/** Same request-local token boundary for queries and all canonical fields. */
export function taskSignalTokens(text: string): readonly string[] {
  const normalized = text.normalize("NFKC");
  const tokens: string[] = [];
  const appendWords = (part: string): void => {
    for (const token of tokenizeKeywordText(part)) {
      if (!FUNCTION_WORDS.has(token)) tokens.push(token);
    }
  };
  let offset = 0;
  for (const match of normalized.matchAll(TECHNICAL_COMPOUND)) {
    appendWords(normalized.slice(offset, match.index));
    tokens.push(match[0].toLowerCase());
    offset = match.index + match[0].length;
  }
  appendWords(normalized.slice(offset));
  return Object.freeze(tokens);
}

/**
 * An injective alphabetic encoding keeps each private token whole through both
 * the keyword adapter's tokenizer and SQLite unicode61. It is never persisted.
 */
export function encodeTaskSignalToken(token: string): string {
  return (
    "t" +
    Array.from(utf8.encode(token), (byte) =>
      String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)),
    ).join("")
  );
}
