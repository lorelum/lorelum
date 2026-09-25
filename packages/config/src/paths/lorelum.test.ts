import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import {
  defaultDiagnosticsFallbackDirectory,
  defaultFeedbackDirectory,
  defaultLogDirectory,
  resolveLorelumPaths,
} from "./lorelum";

test("resolves feedback artifacts below the user-scoped Lorelum root", () => {
  const homeDirectory = "/tmp/lorelum-home";
  expect(defaultFeedbackDirectory(homeDirectory)).toBe(join(homeDirectory, ".lorelum", "feedback"));
  expect(defaultLogDirectory(homeDirectory)).toBe(join(homeDirectory, ".lorelum", "logs"));
  expect(resolveLorelumPaths(homeDirectory).rootDirectory).toBe(join(homeDirectory, ".lorelum"));
});

test("resolves the diagnostics fallback as a private sibling of the Lorelum root", () => {
  const homeDirectory = "/tmp/lorelum-home";
  expect(defaultDiagnosticsFallbackDirectory(homeDirectory)).toBe(
    join(homeDirectory, ".lorelum-diagnostics"),
  );
});

test("path resolution never touches the filesystem", async () => {
  const homeDirectory = "/tmp/lorelum-home-paths-only";
  expect(defaultDiagnosticsFallbackDirectory(homeDirectory)).toBe(
    join(homeDirectory, ".lorelum-diagnostics"),
  );
  await expect(stat(homeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});
