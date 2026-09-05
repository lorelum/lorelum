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
    for (const piece of splitScriptRuns(run)) {
      if (isCjkPiece(piece)) tokens.push(...segmentCjk(piece));
      else tokens.push(piece);
    }
  }
  return tokens;
}

/**
 * Split a mixed-script run into contiguous Latin/numeric and CJK pieces, so a
 * title such as `Add remote 接口请求` contributes CJK bigrams without dropping
 * the Latin words. Words that cross the script boundary are treated as
 * separate tokens on both sides.
 */
function splitScriptRuns(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (let index = 1; index < text.length; index += 1) {
    const boundary = isCjk(text[index - 1]!) !== isCjk(text[index]!);
    if (boundary) {
      pieces.push(text.slice(start, index));
      start = index;
    }
  }
  pieces.push(text.slice(start));
  return pieces;
}

const CJK_CODE_POINT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Han, Hiragana, and Katakana runs are bigram-segmented. */
function isCjkPiece(text: string): boolean {
  return [...text].every((codePoint) => CJK_CODE_POINT.test(codePoint));
}

function isCjk(codePoint: string): boolean {
  return CJK_CODE_POINT.test(codePoint);
}

function segmentCjk(text: string): string[] {
  if (text.length === 1) return [text];
  const tokens: string[] = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    tokens.push(text.slice(index, index + 2));
  }
  return tokens;
}
