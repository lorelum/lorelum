import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { run } from "../main.js";
import { snapshotCommandDefinitions } from "../registry.js";
import { createLocalizationCommands } from "./localization-command.js";

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lorelum-localization-command-"));
  await mkdir(join(root, "practices", "requirements"), { recursive: true });
  await mkdir(join(root, "i18n", "zh-CN", "practices", "requirements"), { recursive: true });
  await writeFile(join(root, "pack.yaml"), "name: sample\nversion: 0.1.0\ndescription: sample\n");
  await writeFile(
    join(root, "practices", "requirements", "goal.md"),
    "---\nid: sample.goal\ntitle: Goal\nstage: requirements\ntech_stack: [sample]\napplies_when: when a goal is being clarified\n---\n\nKeep the goal explicit.\n",
  );
  await writeFile(
    join(root, "i18n", "zh-CN", "practices", "requirements", "goal.md"),
    "# 目标\n\n保持目标明确。\n",
  );
  return root;
}

const registry = snapshotCommandDefinitions(createLocalizationCommands());

test("sync creates a manifest without requiring manual digests", async () => {
  const root = await fixture();
  try {
    const output = new MemoryWriter();
    expect(
      await run(["i18n", "sync", root, "--locale", "zh-CN", "--source-locale", "en", "--all"], {
        registry,
        stdout: output,
      }),
    ).toBe(0);
    const response = JSON.parse(output.value);
    expect(response.command).toBe("i18n.sync");
    expect(response.data.synchronized[0].sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await readFile(join(root, "i18n", "manifest.yaml"), "utf8")).toContain("source_digest:");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("format does not advance an existing digest", async () => {
  const root = await fixture();
  try {
    const sync = new MemoryWriter();
    await run(["i18n", "sync", root, "--locale", "zh-CN", "--source-locale", "en", "--all"], {
      registry,
      stdout: sync,
    });
    const before = await readFile(join(root, "i18n", "manifest.yaml"), "utf8");
    const output = new MemoryWriter();
    expect(await run(["format", root], { registry, stdout: output })).toBe(0);
    expect(await readFile(join(root, "i18n", "manifest.yaml"), "utf8")).toContain(
      before.match(/source_digest:.*$/m)?.[0] ?? "source_digest:",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validate reports stale localization as a completed finding", async () => {
  const root = await fixture();
  try {
    const sync = new MemoryWriter();
    await run(["i18n", "sync", root, "--locale", "zh-CN", "--source-locale", "en", "--all"], {
      registry,
      stdout: sync,
    });
    await writeFile(
      join(root, "practices", "requirements", "goal.md"),
      "---\nid: sample.goal\ntitle: Changed\nstage: requirements\ntech_stack: [sample]\napplies_when: when a goal is being clarified\n---\n\nKeep the goal explicit.\n",
    );
    const output = new MemoryWriter();
    expect(await run(["validate", root], { registry, stdout: output })).toBe(1);
    const response = JSON.parse(output.value);
    expect(response.ok).toBe(true);
    expect(response.data.localization.locales[0].stale).toEqual(["practices/requirements/goal.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
