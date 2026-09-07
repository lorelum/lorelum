import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";

import { KeywordIndexError, KeywordIndexUnavailableError } from "../errors";
import { buildKeywordIndex } from "./keyword-index";
import type { KeywordDocument } from "./projection";

function document(
  practiceId: string,
  fields: Partial<Omit<KeywordDocument, "practiceId" | "contentDigest">> = {},
): KeywordDocument {
  return {
    practiceId,
    contentDigest: `${practiceId}-digest`,
    id: practiceId,
    title: "",
    appliesWhen: "",
    techStack: "",
    stage: "",
    antiPatterns: "",
    body: "",
    ...fields,
  };
}

test("uses real FTS5 ranking, fixed field weights, and stable Practice-ID ties", () => {
  const index = buildKeywordIndex([
    document("zebra.body", { body: "react" }),
    document("alpha.id", { id: "react" }),
    document("bravo.title", { title: "react" }),
    document("alpha.tie", { title: "stable" }),
    document("zebra.tie", { title: "stable" }),
  ]);
  try {
    const ranked = index.search("react", 3);
    expect(ranked.map((candidate) => candidate.practiceId)).toEqual([
      "alpha.id",
      "bravo.title",
      "zebra.body",
    ]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    expect(ranked[1]!.score).toBeGreaterThan(ranked[2]!.score);
    expect(index.search("stable", 2).map((candidate) => candidate.practiceId)).toEqual([
      "alpha.tie",
      "zebra.tie",
    ]);
  } finally {
    index.close();
  }
});

test("treats FTS operators as literal query tokens and shares Unicode segmentation", () => {
  const index = buildKeywordIndex([
    document("operators.literal", { title: "OR" }),
    document("api.http-server", { title: "HTTPServer" }),
    document("browser.local-storage", { title: "localStorage" }),
    document("frontend.interface", { body: "前端接口" }),
    document("unicode.full-width", { title: "ＡＰＩ" }),
    document("unicode.supplementary-han", { title: "𠮷野" }),
    document("unicode.japanese", { title: "日本語 カタカナ" }),
    document("unicode.hangul", { title: "한글" }),
  ]);
  try {
    expect(index.search("OR", 5).map((candidate) => candidate.practiceId)).toEqual([
      "operators.literal",
    ]);
    expect(index.search("http server", 5).map((candidate) => candidate.practiceId)).toEqual([
      "api.http-server",
    ]);
    expect(index.search("httpserver", 5).map((candidate) => candidate.practiceId)).toEqual([
      "api.http-server",
    ]);
    expect(index.search("HTTPSERVER", 5).map((candidate) => candidate.practiceId)).toEqual([
      "api.http-server",
    ]);
    expect(index.search("localstorage", 5).map((candidate) => candidate.practiceId)).toEqual([
      "browser.local-storage",
    ]);
    expect(index.search("LOCALSTORAGE", 5).map((candidate) => candidate.practiceId)).toEqual([
      "browser.local-storage",
    ]);
    expect(index.search("接口", 5).map((candidate) => candidate.practiceId)).toEqual([
      "frontend.interface",
    ]);
    expect(index.search("api", 5).map((candidate) => candidate.practiceId)).toEqual([
      "api.http-server",
      "unicode.full-width",
    ]);
    expect(index.search("𠮷野", 5).map((candidate) => candidate.practiceId)).toEqual([
      "unicode.supplementary-han",
    ]);
    expect(index.search("日本語", 5).map((candidate) => candidate.practiceId)).toEqual([
      "unicode.japanese",
    ]);
    expect(index.search("カタカナ", 5).map((candidate) => candidate.practiceId)).toEqual([
      "unicode.japanese",
    ]);
    expect(index.search("한글", 5).map((candidate) => candidate.practiceId)).toEqual([
      "unicode.hangul",
    ]);
    expect(index.search("***", 5)).toEqual([]);
  } finally {
    index.close();
  }
});

test("close is idempotent and search-after-close is explicit", () => {
  const index = buildKeywordIndex([document("platform.api", { title: "API" })]);
  index.close();
  index.close();
  expect(() => index.search("api", 1)).toThrow(KeywordIndexError);
  expect(() => index.search("api", 1)).toThrow("closed");
});

test("rejects an invalid direct-search limit with a typed index error", () => {
  const index = buildKeywordIndex([document("platform.api", { title: "API" })]);
  try {
    expect(() => index.search("api", 0)).toThrow(KeywordIndexError);
  } finally {
    index.close();
  }
});

test("closes the private connection when FTS5 construction fails", () => {
  const exec = spyOn(Database.prototype, "exec");
  const close = spyOn(Database.prototype, "close");
  try {
    exec.mockImplementationOnce(() => {
      throw new Error("no such module: fts5");
    });
    expect(() => buildKeywordIndex([document("platform.api")])).toThrow(
      KeywordIndexUnavailableError,
    );
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    exec.mockRestore();
    close.mockRestore();
  }
});

test("closes the private connection when document insertion cannot be prepared", () => {
  const query = spyOn(Database.prototype, "query");
  const close = spyOn(Database.prototype, "close");
  try {
    query.mockImplementationOnce(() => {
      throw new Error("injected insert preparation failure");
    });
    expect(() => buildKeywordIndex([document("platform.api")])).toThrow(KeywordIndexError);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    query.mockRestore();
    close.mockRestore();
  }
});
