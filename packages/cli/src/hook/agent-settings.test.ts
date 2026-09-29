import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "@lorelum/config";

import { DEFAULT_AGENT_HOOK_SETTINGS, loadAgentHookSettings } from "./agent-settings.js";

test("defaults to lore-only without changing other configuration sections", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-agent-settings-"));
  try {
    expect(await loadAgentHookSettings({ homeDirectory: home })).toEqual(
      DEFAULT_AGENT_HOOK_SETTINGS,
    );
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), "query:\n  maxWaitMs: 2500\n");
    expect(await loadAgentHookSettings({ homeDirectory: home })).toEqual(
      DEFAULT_AGENT_HOOK_SETTINGS,
    );
    await writeFile(
      join(home, ".lorelum", "config.yaml"),
      "codex:\n  shellSessionInjection: all-shell\n",
    );
    expect(await loadAgentHookSettings({ homeDirectory: home })).toEqual(
      DEFAULT_AGENT_HOOK_SETTINGS,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("reads the shared all-shell setting", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-agent-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(
      join(home, ".lorelum", "config.yaml"),
      "query:\n  maxWaitMs: 2500\nagent:\n  shellSessionInjection: all-shell\n",
    );
    expect(await loadAgentHookSettings({ homeDirectory: home })).toEqual({
      shellSessionInjection: "all-shell",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.each([
  "agent: []\n",
  "agent:\n  shellSessionInjection: sometimes\n",
  "agent:\n  shellSessionInjection: true\n",
  "agent: [\n",
])(
  "rejects invalid shared Agent Hook configuration without exposing its contents",
  async (source) => {
    const home = await mkdtemp(join(tmpdir(), "lorelum-agent-settings-"));
    try {
      await mkdir(join(home, ".lorelum"));
      await writeFile(join(home, ".lorelum", "config.yaml"), source);
      await expect(loadAgentHookSettings({ homeDirectory: home })).rejects.toEqual(
        new ConfigError(),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
