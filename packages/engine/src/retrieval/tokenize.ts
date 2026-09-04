/**
 * Deterministic tokenization shared by retrieval modules.
 *
 * Latin and numeric runs stay whole words. CJK runs become overlapping
 * bigrams so Chinese tasks can match contiguous Chinese Practice text without
 * a segmentation dependency.
 */
export function normalizeTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (isCjkRun(run)) {
      if (run.length === 1) tokens.push(run);
      for (let index = 0; index < run.length - 1; index += 1) {
        tokens.push(run.slice(index, index + 2));
      }
    } else {
      tokens.push(run);
    }
  }
  return tokens;
}

/** Han, Hiragana, and Katakana runs are bigram-segmented. */
function isCjkRun(text: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(text);
}
