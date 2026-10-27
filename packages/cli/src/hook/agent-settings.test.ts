import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "@lorelum/config";

import {
  DEFAULT_AGENT_HOOK_SETTINGS,
  loadAgentHookSettings,
  loadSubagentPackCatalogSetting,
} from "./agent-settings.js";

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
      await expect(loadAgentHookSettings({ homeDirectory: home })).rejects.toBeInstanceOf(
        ConfigError,
      );
      await expect(loadAgentHookSettings({ homeDirectory: home })).rejects.not.toThrow(
        source.trim(),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

test.each([
  { source: undefined, expected: false },
  { source: "query:\n  maxWaitMs: 2500\n", expected: false },
  { source: "agent:\n  shellSessionInjection: all-shell\n", expected: false },
  { source: "agent:\n  subagentPackCatalog: false\n", expected: false },
  { source: "agent:\n  subagentPackCatalog: true\n", expected: true },
  {
    source: "agent:\n  shellSessionInjection: invalid\n  subagentPackCatalog: true\n",
    expected: true,
  },
])("reads independent subagent Catalog setting from $source", async ({ source, expected }) => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-agent-settings-"));
  try {
    if (source !== undefined) {
      await mkdir(join(home, ".lorelum"));
      await writeFile(join(home, ".lorelum", "config.yaml"), source);
    }
    expect(await loadSubagentPackCatalogSetting({ homeDirectory: home })).toBe(expected);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test.each([
  "agent: []\n",
  "agent:\n  subagentPackCatalog: 'true'\n",
  "agent:\n  subagentPackCatalog: 1\n",
  "agent:\n  subagentPackCatalog: null\n",
  "agent: [\n",
])("rejects malformed subagent Catalog setting %s", async (source) => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-agent-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(join(home, ".lorelum", "config.yaml"), source);
    await expect(loadSubagentPackCatalogSetting({ homeDirectory: home })).rejects.toBeInstanceOf(
      ConfigError,
    );
    await expect(loadSubagentPackCatalogSetting({ homeDirectory: home })).rejects.not.toThrow(
      source.trim(),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("invalid subagent Catalog setting does not perturb a shell-only settings consumer", async () => {
  const home = await mkdtemp(join(tmpdir(), "lorelum-agent-settings-"));
  try {
    await mkdir(join(home, ".lorelum"));
    await writeFile(
      join(home, ".lorelum", "config.yaml"),
      "agent:\n  shellSessionInjection: all-shell\n  subagentPackCatalog: invalid\n",
    );
    expect(await loadAgentHookSettings({ homeDirectory: home })).toEqual({
      shellSessionInjection: "all-shell",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
