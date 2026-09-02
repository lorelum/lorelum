import { expect, test } from "bun:test";

import { CliError } from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "./storage-root.js";

test("keeps the default Store when no override is supplied", () => {
  const fallback = { rootPath: "/user/.lorelum" };

  expect(resolveInvocationStorageRoot(undefined, fallback, "/worktree")).toBe(fallback);
});

test("resolves a relative Store override from the invocation working directory", () => {
  expect(
    resolveInvocationStorageRoot(".git/lorelum/store", { rootPath: "/user/.lorelum" }, "/worktree"),
  ).toEqual({ rootPath: "/worktree/.git/lorelum/store" });
});

test("rejects an empty Store override", () => {
  expect(() =>
    resolveInvocationStorageRoot("", { rootPath: "/user/.lorelum" }, "/worktree"),
  ).toThrow(CliError);
});
