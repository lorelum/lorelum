import { expect, test } from "bun:test";

import { projectMultiViewQuery } from "./query-views";

test("drops the whole-sentence view and keeps independent clauses", () => {
  const views = projectMultiViewQuery(
    "I am opening a PR that fixes a React cache bug; a reviewer will see it without our chat history, so make the context self-contained.",
  );

  expect(views.map((view) => view.text)).toEqual([
    "I am opening a PR that fixes a React cache bug",
    "a reviewer will see it without our chat history",
    "so make the context self-contained",
  ]);
  expect(views.map((view) => view.weight)).toEqual([1, 1, 1]);
  expect(views.map((view) => view.inputKey)).toEqual(["clause:0000", "clause:0001", "clause:0002"]);
});

test("splits CJK clauses without a word tokenizer and keeps one view for an atomic query", () => {
  expect(
    projectMultiViewQuery("检查缓存去重；保留请求隔离，确保每个用户只看到自己的数据。").map(
      (view) => view.text,
    ),
  ).toEqual(["检查缓存去重", "保留请求隔离", "确保每个用户只看到自己的数据"]);

  expect(projectMultiViewQuery("去重").map((view) => view.text)).toEqual(["去重"]);
});
