import { expect, test } from "bun:test";

import { encodeKeywordMatch, tokenizeKeywordText } from "./tokenizer";

test("normalizes Unicode, preserves whole technical identifiers, and splits their components", () => {
  expect(tokenizeKeywordText("ＦｏｏBar HTTPServer user_id kube-api v2 中文接口 单")).toEqual([
    "foobar",
    "foo",
    "bar",
    "httpserver",
    "http",
    "server",
    "user",
    "id",
    "kube",
    "api",
    "v2",
    "v",
    "2",
    "中文",
    "文接",
    "接口",
    "单",
  ]);
});

test("uses overlapping tokens for supplementary Han, Japanese and Hangul runs", () => {
  expect(tokenizeKeywordText("𠮷野 日本語 カタカナ 한글")).toEqual([
    "𠮷野",
    "日本",
    "本語",
    "カタ",
    "タカ",
    "カナ",
    "한글",
  ]);
});

test("encodes unique tokens as quoted literal FTS terms", () => {
  expect(encodeKeywordMatch(["or", "alpha", "or"])).toBe('"or" OR "alpha"');
  expect(encodeKeywordMatch([])).toBeUndefined();
});
