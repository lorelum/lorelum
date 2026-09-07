import { expect, test } from "bun:test";
import { InvalidQueryRequestError } from "./errors";
import { parseQueryRequest } from "./request";
import type { QueryRequest } from "./types";

test("query parser trims text and owns the default limit", () => {
  expect(parseQueryRequest({ text: "  React auth\n" })).toEqual({ text: "React auth", limit: 5 });
  expect(parseQueryRequest({ text: "请求", limit: 50 }).limit).toBe(50);
});

test.each([
  null,
  undefined,
  {},
  { text: 1 },
  { text: "" },
  { text: " \n\t " },
  { text: "x".repeat(4097) },
  { text: "x", limit: 0 },
  { text: "x", limit: -1 },
  { text: "x", limit: 51 },
  { text: "x", limit: 1.5 },
  { text: "x", limit: NaN },
  { text: "x", limit: Infinity },
  { text: "x", limit: "5" },
  { text: "x", limit: null },
])("query parser rejects invalid request %#", (request) => {
  expect(() => parseQueryRequest(request as QueryRequest)).toThrow(InvalidQueryRequestError);
});

test("query length counts Unicode code points, not UTF-16 code units", () => {
  const text = "𠮷".repeat(4096);
  expect(parseQueryRequest({ text: ` ${text} ` }).text).toBe(text);
  expect(() => parseQueryRequest({ text: `${text}𠮷` })).toThrow(InvalidQueryRequestError);
});

test("punctuation is valid input even if it produces no search tokens", () => {
  expect(parseQueryRequest({ text: "!!!" })).toEqual({ text: "!!!", limit: 5 });
});
