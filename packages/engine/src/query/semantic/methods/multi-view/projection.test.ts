import { expect, test } from "bun:test";

import type { EffectivePractice } from "../../../../local-store";
import { canonicalizePractice } from "../../../../local-store/model";
import {
  estimatedTokens,
  projectMultiViewDocument,
  SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS,
} from "./projection";
import { multiViewRecipe } from "./method";

function practice(body: string): EffectivePractice {
  const canonical = canonicalizePractice({
    id: "platform.projection",
    title: "Projection fixture",
    stage: "implementation",
    tech_stack: ["typescript"],
    applies_when: "Checking semantic views.",
    body,
    severity: "warn",
  });
  return { practiceId: "platform.projection", ...canonical, sources: [] };
}

test("projects task-card and heading-aware body views deterministically, without a full view", () => {
  const document = projectMultiViewDocument(
    practice("## Review\n\nKeep the exception and its condition.\n\nReview the result."),
    multiViewRecipe,
  );

  expect(document.inputs.map((view) => view.inputKey)).toEqual([
    "task-card:0000",
    "body:0000",
    "body:0001",
  ]);
  expect(
    document.inputs.filter((view) => view.channel === "body").map((view) => view.text),
  ).toEqual(["Review\n\nKeep the exception and its condition.", "Review\n\nReview the result."]);
  expect(
    projectMultiViewDocument(
      practice("## Review\n\nKeep the exception and its condition.\n\nReview the result."),
      multiViewRecipe,
    ),
  ).toEqual(document);
});

test("keeps ids, field labels and the tech stack out of every view", () => {
  const document = projectMultiViewDocument(
    practice("## Review\n\nKeep the condition."),
    multiViewRecipe,
  );
  const taskCard = document.inputs.find((view) => view.channel === "task-card");

  expect(taskCard?.text).toBe("Projection fixture\n\nChecking semantic views.\n\nimplementation");
  for (const view of document.inputs) {
    expect(view.text).not.toContain("platform.projection");
    expect(view.text).not.toContain("typescript");
  }
});

test("a local body edit reuses the task card and untouched body chunks", () => {
  const original = projectMultiViewDocument(
    practice("## Review\n\nKeep the exception and its condition.\n\nReview the result."),
    multiViewRecipe,
  );
  const changed = projectMultiViewDocument(
    practice("## Review\n\nKeep the exception and its condition.\n\nReview the replacement."),
    multiViewRecipe,
  );

  expect(changed.inputs.find((view) => view.channel === "task-card")?.inputDigest).toBe(
    original.inputs.find((view) => view.channel === "task-card")?.inputDigest,
  );
  expect(changed.inputs[1]?.inputDigest).toBe(original.inputs[1]?.inputDigest);
  expect(changed.inputs[2]?.inputDigest).not.toBe(original.inputs[2]?.inputDigest);
  expect(changed.projectionDigest).not.toBe(original.projectionDigest);
});

test("splits an unpunctuated CJK body by the estimated token budget", () => {
  const body = Array.from(
    { length: 400 },
    () => "当同一个服务端渲染中多个组件重复执行相同的请求级查询时应当去重",
  ).join("");
  const document = projectMultiViewDocument(practice(body), multiViewRecipe);
  const chunked = document.inputs.filter((view) => view.channel === "body");

  expect(chunked.length).toBeGreaterThan(1);
  for (const view of document.inputs) {
    expect(estimatedTokens(view.text)).toBeLessThanOrEqual(SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS);
  }
  expect(chunked.map((view) => view.text).join("")).toContain("服务端渲染");
});

test("every body view, including its heading context, stays within the token budget", () => {
  const heading = `## ${"服务端渲染设计".repeat(20)}`;
  const paragraph = "当同一个服务端渲染中多个组件重复执行相同的请求级查询时应当去重。".repeat(40);
  const views = projectMultiViewDocument(
    practice(`${heading}\n\n${paragraph}`),
    multiViewRecipe,
  ).inputs.filter((view) => view.channel === "body");
  expect(views.length).toBeGreaterThan(1);
  for (const view of views) {
    expect(estimatedTokens(view.text)).toBeLessThanOrEqual(SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS);
  }
});

test("nested headings keep the most specific context and stay within budget", () => {
  const body = [
    `# ${"平台".repeat(60)}`,
    `## ${"子系统".repeat(30)}`,
    "### 缓存",
    "",
    "缓存失效时需要同时清理派生视图。".repeat(30),
  ].join("\n");
  const views = projectMultiViewDocument(practice(body), multiViewRecipe).inputs.filter(
    (view) => view.channel === "body",
  );
  for (const view of views) {
    expect(estimatedTokens(view.text)).toBeLessThanOrEqual(SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS);
  }
  expect(views.at(-1)?.text).toContain("缓存");
});

test("a heading longer than the budget on its own is cut, not dropped, and body text survives", () => {
  const body = `# ${"极长标题".repeat(200)}\n\n正文第一段。`;
  const views = projectMultiViewDocument(practice(body), multiViewRecipe).inputs.filter(
    (view) => view.channel === "body",
  );
  expect(views.length).toBeGreaterThan(0);
  for (const view of views) {
    expect(estimatedTokens(view.text)).toBeLessThanOrEqual(SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS);
  }
  expect(views.some((view) => view.text.includes("正文第一段"))).toBe(true);
});
