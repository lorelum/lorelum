import { expect, test } from "bun:test";

import { resolveOutputFormat } from "./format-selection.js";
import { commandRegistry } from "../registry.js";

test("defaults every ordinary invocation to text", () => {
  expect(resolveOutputFormat([], commandRegistry)).toMatchObject({
    commandName: "lore",
    format: "text",
  });
  expect(resolveOutputFormat(["describe", "query"], commandRegistry)).toMatchObject({
    commandName: "describe",
    format: "text",
  });
  expect(resolveOutputFormat(["query", "relevant practice"], commandRegistry)).toMatchObject({
    commandName: "query",
    format: "text",
  });
});

test("recognizes only a real JSON global option", () => {
  expect(
    resolveOutputFormat(["query", "relevant practice", "--json"], commandRegistry),
  ).toMatchObject({
    commandName: "query",
    format: "json",
  });
  expect(resolveOutputFormat(["--json", "unknown"], commandRegistry)).toMatchObject({
    commandName: "unknown",
    format: "json",
  });
  expect(
    resolveOutputFormat(["query", "relevant practice", "--", "--json"], commandRegistry),
  ).toMatchObject({
    commandName: "query",
    format: "text",
  });
  expect(
    resolveOutputFormat(["pack", "install", "example", "--registry", "--json"], commandRegistry),
  ).toMatchObject({ commandName: "pack.install", format: "text" });
});

test("selects static version response and its JSON override", () => {
  expect(resolveOutputFormat(["--version"], commandRegistry)).toMatchObject({
    commandName: "version",
    format: "text",
  });
  expect(resolveOutputFormat(["--version", "--json"], commandRegistry)).toMatchObject({
    commandName: "version",
    format: "json",
  });
});
