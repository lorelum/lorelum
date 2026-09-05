import { describe, expect, test } from "bun:test";

import { normalizeTokens } from "./tokenize.js";

describe("normalizeTokens", () => {
  test("lowercases Latin and numeric runs and splits on non-word characters", () => {
    expect(normalizeTokens("React 18, API-client!")).toEqual(["react", "18", "api", "client"]);
  });

  test("returns an empty list when the text has no letter or number runs", () => {
    expect(normalizeTokens("--- !!! ???")).toEqual([]);
  });

  test("segments contiguous Han text into overlapping bigrams", () => {
    expect(normalizeTokens("组件请求")).toEqual(["组件", "件请", "请求"]);
  });

  test("keeps a single CJK character as its own token", () => {
    expect(normalizeTokens("端")).toEqual(["端"]);
  });

  test("splits Han, Hiragana, and Katakana runs", () => {
    expect(normalizeTokens("依頼コンポ")).toEqual(["依頼", "頼コ", "コン", "ンポ"]);
  });

  test("segments CJK pieces inside mixed Latin and CJK runs", () => {
    expect(normalizeTokens("remote接口请求")).toEqual(["remote", "接口", "口请", "请求"]);
    expect(normalizeTokens("Add remote 接口请求")).toEqual([
      "add",
      "remote",
      "接口",
      "口请",
      "请求",
    ]);
  });
});
