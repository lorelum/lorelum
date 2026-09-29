import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "@lorelum/config";

import { DEFAULT_CODEX_HOOK_SETTINGS, loadCodexHookSettings } from "./codex-settings.js";

test("defaults to lore-only without changing other configuration sections", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-codex-settings-"));
  try {
    expect(await loadCodexHookSettings({ homeDirectory: home })).toEqual(
      DEFAULT_CODEX_HOOK_SETTINGS,
    );
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "query:\n  maxWaitMs: 2500\n");
    expect(await loadCodexHookSettings({ homeDirectory: home })).toEqual(
      DEFAULT_CODEX_HOOK_SETTINGS,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("reads the explicit all-shell setting", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-codex-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(
      join(home, ".lorelum", "config.yaml"),
      "query:\n  maxWaitMs: 2500\ncodex:\n  shellSessionInjection: all-shell\n",
    );
    expect(await loadCodexHookSettings({ homeDirectory: home })).toEqual({
      shellSessionInjection: "all-shell",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.each([
  "codex: []\n",
  "codex:\n  shellSessionInjection: sometimes\n",
  "codex:\n  shellSessionInjection: true\n",
  "codex: [\n",
])("rejects invalid Codex Hook configuration without exposing its contents", async (source) => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-codex-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), source);
    await expect(loadCodexHookSettings({ homeDirectory: home })).rejects.toEqual(new ConfigError());
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
