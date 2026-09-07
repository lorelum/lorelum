const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_CHARACTERS = /[\p{L}\p{N}]+/gu;

function appendCjkTokens(text: string, tokens: string[]): void {
  const characters = Array.from(text);
  if (characters.length === 1) {
    tokens.push(characters[0]!);
    return;
  }
  for (let index = 0; index < characters.length - 1; index++) {
    tokens.push(`${characters[index]}${characters[index + 1]}`);
  }
}

function appendTechnicalTokens(text: string, tokens: string[]): void {
  for (const match of text.matchAll(WORD_CHARACTERS)) {
    const original = match[0];
    // Split technical identifiers before lowercasing, including acronym-to-word
    // boundaries such as HTTPServer -> HTTP + Server.
    const segments = original
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/([\p{L}])(\d)/gu, "$1 $2")
      .replace(/(\d)([\p{L}])/gu, "$1 $2")
      .match(/[^\s]+/g);
    if (segments === null || segments.length === 0) continue;
    if (segments.length > 1) tokens.push(original.toLowerCase());
    for (const segment of segments) {
      tokens.push(segment.toLowerCase());
    }
  }
}

/**
 * Produce the same normalized token stream for document fields and queries.
 * Contiguous CJK text uses overlapping bigrams; a one-character run is kept
 * as one token so it is not silently lost.
 */
export function tokenizeKeywordText(text: string): readonly string[] {
  const normalized = text.normalize("NFKC");
  const tokens: string[] = [];
  let cjkRun = "";
  let technicalRun = "";

  const flushCjk = (): void => {
    if (cjkRun.length > 0) appendCjkTokens(cjkRun, tokens);
    cjkRun = "";
  };
  const flushTechnical = (): void => {
    if (technicalRun.length > 0) appendTechnicalTokens(technicalRun, tokens);
    technicalRun = "";
  };

  for (const character of normalized) {
    if (CJK_CHARACTER.test(character)) {
      flushTechnical();
      cjkRun += character;
    } else {
      flushCjk();
      technicalRun += character;
    }
  }
  flushCjk();
  flushTechnical();
  return Object.freeze(tokens);
}

/** Encode already-tokenized text as literal FTS5 terms, never raw MATCH syntax. */
export function encodeKeywordMatch(tokens: readonly string[]): string | undefined {
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return undefined;
  // Tokenizer output excludes quotes, but keep this escaping here so the FTS
  // syntax boundary remains correct if tokenization evolves.
  return uniqueTokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}
