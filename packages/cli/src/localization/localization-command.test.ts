import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { run } from "../main.js";
import { describeCommand, snapshotCommandDefinitions } from "../registry.js";
import { createLocalizationCommands } from "./index.js";

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

/** File symlinks need Developer Mode or elevation on Windows; probe once instead of assuming. */
async function canCreateSymlinks(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const directory = await mkdtemp(join(tmpdir(), "lorelum-symlink-probe-"));
  try {
    const target = join(directory, "target");
    await writeFile(target, "fixture");
    await symlink(target, join(directory, "link"));
    return true;
  } catch {
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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

test("validate turns recoverable ProjectContext warnings into strict diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-project-validate-"));
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await writeFile(
      join(pack, "practices", "valid.md"),
      "---\nid: platform.valid\ntitle: Valid\nstage: implementation\ntech_stack: [typescript]\napplies_when: When checking project diagnostics.\n---\nKeep the valid neighbor.\n",
    );
    await writeFile(
      join(pack, "practices", "broken.md"),
      "---\nid: platform.broken\nstage: implementation\n---\nThis Practice is deliberately malformed.\n",
    );

    const output = new MemoryWriter();
    expect(await run(["validate", root], { registry, stdout: output })).toBe(1);
    const response = JSON.parse(output.value);
    expect(response).toMatchObject({
      command: "validate",
      ok: true,
      data: {
        project: {
          valid: false,
          state: "degraded",
          diagnostics: [expect.objectContaining({ code: "project.practice.invalid" })],
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validate reports resource targets structurally and never executes Pack scripts", async () => {
  const root = await fixture();
  try {
    await rm(join(root, "i18n"), { recursive: true, force: true });
    const marker = join(root, "script-was-run");
    await mkdir(join(root, "references"), { recursive: true });
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "references", "api.md"), "Reference material.\n");
    await writeFile(join(root, "scripts", "helper.sh"), `#!/bin/sh\ntouch "${marker}"\n`);
    await writeFile(
      join(root, "practices", "requirements", "goal.md"),
      "---\nid: sample.goal\ntitle: Goal\nstage: requirements\ntech_stack: [sample]\napplies_when: when a goal is being clarified\n---\n\nRead [the reference](resource:references/api.md).\n",
    );

    const valid = new MemoryWriter();
    expect(await run(["validate", root], { registry, stdout: valid })).toBe(0);
    expect(JSON.parse(valid.value).data.pack).toMatchObject({ valid: true });
    await expect(Bun.file(marker).exists()).resolves.toBe(false);

    await writeFile(
      join(root, "practices", "requirements", "goal.md"),
      "---\nid: sample.goal\ntitle: Goal\nstage: requirements\ntech_stack: [sample]\napplies_when: when a goal is being clarified\n---\n\nRead [the missing reference](resource:references/missing.md).\n",
    );
    const invalid = new MemoryWriter();
    expect(await run(["validate", root], { registry, stdout: invalid })).toBe(1);
    expect(JSON.parse(invalid.value).data.pack).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          code: "resource-target-missing",
          path: expect.stringMatching(/^practices\/requirements\/goal\.md:\d+:\d+$/),
        }),
      ]),
    });
    await expect(Bun.file(marker).exists()).resolves.toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validate turns unsafe resource directories into structural diagnostics", async () => {
  const root = await fixture();
  try {
    if (!(await canCreateSymlinks())) return;
    await writeFile(join(root, "resource-target"), "not a directory\n");
    await symlink(join(root, "resource-target"), join(root, "assets"));
    const output = new MemoryWriter();
    expect(await run(["validate", root], { registry, stdout: output })).toBe(1);
    const response = JSON.parse(output.value);
    expect(response.ok).toBe(true);
    expect(response.data.pack).toEqual({
      valid: false,
      diagnostics: [
        expect.objectContaining({
          level: "error",
          code: "snapshot.invalid",
          path: "assets",
          message: "Pack directory structure is invalid.",
        }),
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects localized runtime frontmatter and keeps format error allowlists narrow", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, "i18n", "zh-CN", "practices", "requirements", "goal.md"),
      "---\ntitle: forbidden\n---\n\n# 目标\n",
    );
    const output = new MemoryWriter();
    expect(await run(["format", root], { registry, stdout: output })).toBe(2);
    const response = JSON.parse(output.value);
    expect(response.error.code).toBe("localization.invalid");
    expect(
      (describeCommand("format", registry) as { errorCodes: readonly string[] }).errorCodes,
    ).toEqual(["usage.invalid", "runtime.unexpected", "localization.invalid"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires source locale for a new manifest and rejects a mismatch", async () => {
  const root = await fixture();
  try {
    const missing = new MemoryWriter();
    expect(
      await run(["i18n", "sync", root, "--locale", "zh-CN", "--all"], {
        registry,
        stdout: missing,
      }),
    ).toBe(2);
    expect(JSON.parse(missing.value).error.code).toBe("localization.invalid");
    const initial = new MemoryWriter();
    expect(
      await run(["i18n", "sync", root, "--locale", "zh-CN", "--source-locale", "en", "--all"], {
        registry,
        stdout: initial,
      }),
    ).toBe(0);
    const mismatch = new MemoryWriter();
    expect(
      await run(["i18n", "sync", root, "--locale", "zh-CN", "--source-locale", "de", "--all"], {
        registry,
        stdout: mismatch,
      }),
    ).toBe(2);
    expect(JSON.parse(mismatch.value).error.code).toBe("localization.invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects mutually exclusive sync selectors and unsafe localized sources", async () => {
  const root = await fixture();
  try {
    const both = new MemoryWriter();
    expect(
      await run(
        [
          "i18n",
          "sync",
          root,
          "--locale",
          "zh-CN",
          "--source-locale",
          "en",
          "--all",
          "--practice",
          "sample.goal",
        ],
        { registry, stdout: both },
      ),
    ).toBe(2);
    expect(JSON.parse(both.value).error.code).toBe("usage.invalid");
    await rm(join(root, "i18n", "zh-CN", "practices", "requirements", "goal.md"));
    if (await canCreateSymlinks()) {
      await symlink(
        join(root, "practices", "requirements", "goal.md"),
        join(root, "i18n", "zh-CN", "practices", "requirements", "goal.md"),
      );
      const unsafe = new MemoryWriter();
      expect(await run(["format", root], { registry, stdout: unsafe })).toBe(2);
      expect(JSON.parse(unsafe.value).error.code).toBe("localization.invalid");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("enforces localized file size budget", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, "i18n", "zh-CN", "practices", "requirements", "goal.md"),
      `# 目标\n\n${"x".repeat(300 * 1024)}\n`,
    );
    const output = new MemoryWriter();
    expect(await run(["format", root], { registry, stdout: output })).toBe(2);
    expect(JSON.parse(output.value).error.code).toBe("localization.invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("treats malformed localization manifest as a localization failure", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, "i18n"), { recursive: true });
    await writeFile(
      join(root, "i18n", "manifest.yaml"),
      "schema_version: 1\nsource_locale: en\nlocales: nope\n",
    );
    const output = new MemoryWriter();
    expect(await run(["validate", root], { registry, stdout: output })).toBe(2);
    expect(JSON.parse(output.value).error.code).toBe("localization.invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
