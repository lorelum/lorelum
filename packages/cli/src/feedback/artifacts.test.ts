import { expect, test } from "bun:test";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { publishFeedbackArtifact } from "./artifacts";
import { renderReportMarkdown } from "./report";
import type { FeedbackReport } from "./types";

function report(): FeedbackReport {
  return {
    schemaVersion: 2,
    kind: "bug",
    summary: "Local report",
    observed: "Observed locally",
    context: { cliVersion: "test", platform: "test", arch: "test" },
    evidence: [{ type: "query", source: "input", text: "raw query" }],
    missingEvidence: [],
    externalReview: { required: true, selectedRawFields: ["query"], credentialSignals: [] },
  };
}

test("publishes unique JSON and Markdown artifacts without putting report content in their names", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-")));
  try {
    const value = report();
    const [first, second] = await Promise.all([
      publishFeedbackArtifact(parent, value, renderReportMarkdown(value)),
      publishFeedbackArtifact(parent, value, renderReportMarkdown(value)),
    ]);
    expect(first.directory).not.toBe(second.directory);
    expect(JSON.parse(await readFile(first.reportPath, "utf8"))).toMatchObject({
      summary: "Local report",
    });
    expect(await readFile(first.markdownPath, "utf8")).toContain("raw query");
    if (process.platform !== "win32") {
      expect((await lstat(first.directory)).mode & 0o077).toBe(0);
      expect((await lstat(first.reportPath)).mode & 0o077).toBe(0);
      expect((await lstat(first.markdownPath)).mode & 0o077).toBe(0);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("cleans up its unique directory when an artifact cannot be serialized", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-cleanup-")));
  try {
    const broken = Object.assign(report(), {
      toJSON() {
        throw new Error("simulated serialization failure");
      },
    }) as FeedbackReport;
    await expect(publishFeedbackArtifact(parent, broken, "unused")).rejects.toThrow(
      "simulated serialization failure",
    );
    expect(await readdir(parent)).toEqual([]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("refuses a regular-file output target without replacing it", async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-file-target-")));
  const target = join(parent, "existing-file");
  try {
    await writeFile(target, "preserve me", "utf8");
    await expect(publishFeedbackArtifact(target, report(), "unused")).rejects.toThrow("unsafe");
    expect(await readFile(target, "utf8")).toBe("preserve me");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

// Creating a symlink needs Developer Mode or admin on Windows, so this
// scenario cannot be constructed there without privileges.
test.skipIf(process.platform === "win32")(
  "refuses a symlink output directory without writing a draft",
  async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "lorelum-feedback-unsafe-")));
    const target = join(parent, "target");
    const redirected = join(parent, "redirected");
    try {
      await Bun.write(target, "not a directory");
      await symlink(target, redirected);
      const value = report();
      await expect(
        publishFeedbackArtifact(redirected, value, renderReportMarkdown(value)),
      ).rejects.toThrow("unsafe");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);
