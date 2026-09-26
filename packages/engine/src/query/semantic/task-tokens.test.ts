import { expect, test } from "bun:test";
import { tokenizeKeywordText } from "../keyword/tokenizer";
import { encodeTaskSignalToken, taskSignalTokens } from "./task-tokens";

test("private task tokens preserve technical atoms without inventing fragment matches", () => {
  expect(taskSignalTokens("I use I/O and HTTP/2 with C++ or C#")).toEqual([
    "use",
    "i/o",
    "http/2",
    "c++",
    "c#",
  ]);
  expect(taskSignalTokens("No C or R without I/O")).toEqual(["no", "c", "r", "without", "i/o"]);
  expect(taskSignalTokens("C/C++ and C++/C#")).toEqual(["c/c++", "c++/c#"]);
  // The persistent/offline keyword contract is deliberately unchanged.
  expect(tokenizeKeywordText("I/O")).toEqual(["i", "o"]);
});

test("task tokens retain normalization, identifier words and CJK bigrams", () => {
  expect(taskSignalTokens("HTTPServer Ｃ＋＋ 中文任务")).toEqual([
    "httpserver",
    "http",
    "server",
    "c++",
    "中文",
    "文任",
    "任务",
  ]);
});

test("token encoding stays injective and survives the keyword adapter unchanged", () => {
  const tokens = ["i/o", "io", "i", "c++", "c", "c#", "中文"];
  const encoded = tokens.map(encodeTaskSignalToken);
  expect(new Set(encoded).size).toBe(tokens.length);
  expect(encoded.every((token) => /^[a-z]+$/.test(token))).toBe(true);
  expect(tokenizeKeywordText(encoded.join(" "))).toEqual(encoded);
});
