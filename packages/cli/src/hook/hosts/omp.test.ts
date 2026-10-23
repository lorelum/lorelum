import { describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListPackDetailsResult } from "@lorelum/engine";
import { run } from "../../main.js";
import type { HookServiceOverrides } from "../command.js";
import { DEFAULT_AGENT_HOOK_SETTINGS, loadSubagentPackCatalogSetting } from "../agent-settings.js";

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

const details: ListPackDetailsResult = {
  generation: 1,
  effectiveRevision: 2,
  packs: [
    {
      name: "engineering",
      version: "0.1.0",
      packRoot: "/private/metadata-only",
      description: "Engineering guidance.",
      applies_to: ["typescript"],
    },
  ],
};

async function invoke(
  payload: string,
  services: HookServiceOverrides = {
    list: { listPackDetails: async () => details },
    storageRoot: { rootPath: "/default-store" },
  },
) {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const exitCode = await run(["hook", "omp"], {
    stdin: { text: async () => payload },
    stdout,
    stderr,
    hookServices: services,
  });
  return { stdout: stdout.value, stderr: stderr.value, exitCode };
}

const catalogRequest = '{"event":"catalog"}';

describe("lore hook omp source entry", () => {
  test("reads metadata once and returns only the extension context envelope", async () => {
    let calls = 0;
    const result = await invoke(catalogRequest, {
      list: {
        async listPackDetails(request) {
          calls += 1;
          expect(request?.storageRoot?.rootPath).toBe("/default-store");
          return details;
        },
      },
      storageRoot: { rootPath: "/default-store" },
    });
    expect(calls).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.split("\n")).toHaveLength(2);
    const response = JSON.parse(result.stdout);
    expect(Object.keys(response)).toEqual(["additionalContext"]);
    expect(response.additionalContext).toContain("Lorelum Installed Pack Catalog");
    expect(response.additionalContext).toContain("- engineering");
    expect(response.additionalContext).toContain("Stack scope: typescript");
    expect(response.additionalContext).toContain("Engineering guidance.");
    expect(response.additionalContext).not.toContain("/private/metadata-only");
    expect(response.additionalContext).not.toContain("0.1.0");
  });

  test("checks updates only for an explicit main request with a valid identity", async () => {
    const poll = mock(async (_deliver: boolean) => "A Lorelum update is available.");
    const result = await invoke(
      JSON.stringify({
        event: "catalog",
        agentKind: "main",
        sessionId: "actual-session",
        checkUpdates: true,
      }),
      {
        list: { listPackDetails: async () => details },
        storageRoot: { rootPath: "/selected-store" },
        autoUpdate: { poll },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(poll).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledWith(true);
    expect(JSON.parse(result.stdout)).toEqual({
      additionalContext: expect.stringContaining("Engineering guidance."),
      updateNotice: "A Lorelum update is available.",
    });
  });

  test.each([
    ["omitted agentKind", { event: "catalog", sessionId: "actual-session", checkUpdates: true }],
    [
      "sub with invalid auto fields",
      { event: "catalog", agentKind: "sub", sessionId: 7, checkUpdates: true },
    ],
    [
      "main with invalid sessionId",
      { event: "catalog", agentKind: "main", sessionId: "", checkUpdates: true },
    ],
    [
      "main without explicit opt-in",
      { event: "catalog", agentKind: "main", sessionId: "actual-session", checkUpdates: false },
    ],
    [
      "main with non-boolean opt-in",
      { event: "catalog", agentKind: "main", sessionId: "actual-session", checkUpdates: "true" },
    ],
  ] as const)("keeps Catalog behavior and skips polling for %s", async (_label, request) => {
    const poll = mock(async () => "must not appear");
    const result = await invoke(JSON.stringify(request), {
      list: { listPackDetails: async () => details },
      storageRoot: { rootPath: "/selected-store" },
      subagentPackCatalog: async () => true,
      autoUpdate: { poll },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).additionalContext).toContain("Engineering guidance.");
    expect(result.stdout).not.toContain("must not appear");
    expect(poll).toHaveBeenCalledTimes(0);
  });

  test("keeps a successful Catalog if auto-update polling rejects", async () => {
    const poll = mock(async () => {
      throw new Error("auto-check unavailable");
    });
    const result = await invoke(
      JSON.stringify({
        event: "catalog",
        agentKind: "main",
        sessionId: "actual-session",
        checkUpdates: true,
      }),
      {
        list: { listPackDetails: async () => details },
        storageRoot: { rootPath: "/selected-store" },
        autoUpdate: { poll },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).additionalContext).toContain("Engineering guidance.");
  });

  test("does not poll when the Catalog itself is unavailable", async () => {
    const poll = mock(async () => "not delivered");
    const result = await invoke(
      JSON.stringify({
        event: "catalog",
        agentKind: "main",
        sessionId: "actual-session",
        checkUpdates: true,
      }),
      {
        list: {
          async listPackDetails() {
            throw new Error("Store unavailable");
          },
        },
        storageRoot: { rootPath: "/broken-store" },
        autoUpdate: { poll },
      },
    );
    expect(result.stdout).toBe("{}\n");
    expect(result.stderr).toContain("Store unavailable");
    expect(poll).toHaveBeenCalledTimes(0);
  });

  test("uses the shared 4000-character budget, ordering and deduplication", async () => {
    const packs = Array.from({ length: 150 }, (_, index) => ({
      ...details.packs[0]!,
      name: `pack-${String(index).padStart(3, "0")}`,
      description: "long metadata ".repeat(100),
    })).reverse();
    const result = await invoke(catalogRequest, {
      list: { listPackDetails: async () => ({ ...details, packs: [...packs, packs[0]!] }) },
      storageRoot: { rootPath: "/default-store" },
    });
    const { additionalContext } = JSON.parse(result.stdout);
    expect(additionalContext.length).toBeLessThanOrEqual(4000);
    expect(additionalContext).toContain("Catalog entries truncated.");
    expect(additionalContext.indexOf("- pack-000")).toBeLessThan(
      additionalContext.indexOf("- pack-001"),
    );
    const duplicate = await invoke(catalogRequest, {
      list: { listPackDetails: async () => ({ ...details, packs: [packs[0]!, packs[0]!] }) },
      storageRoot: { rootPath: "/default-store" },
    });
    expect(JSON.parse(duplicate.stdout).additionalContext.match(/- pack-149/g)).toHaveLength(1);
  });

  test.each(["{", "null", "[]", "{}", '{"event":"query"}', '{"hook_event_name":"SessionStart"}'])(
    "degrades unsupported input %s without reading metadata",
    async (payload) => {
      let calls = 0;
      const result = await invoke(payload, {
        list: {
          async listPackDetails() {
            calls += 1;
            return details;
          },
        },
        storageRoot: { rootPath: "/default-store" },
      });
      expect(calls).toBe(0);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("{}\n");
      expect(result.stderr).toContain("lore hook omp degraded:");
    },
  );

  test("distinguishes an empty installed Store from failed metadata access", async () => {
    const empty = await invoke(catalogRequest, {
      list: { listPackDetails: async () => ({ ...details, packs: [] }) },
      storageRoot: { rootPath: "/empty-store" },
    });
    expect(JSON.parse(empty.stdout).additionalContext).toContain("No installed Knowledge Packs");
    expect(empty.stderr).toBe("");
    const failed = await invoke(catalogRequest, {
      list: {
        async listPackDetails() {
          throw new Error("Store unavailable");
        },
      },
      storageRoot: { rootPath: "/broken-store" },
    });
    expect(failed.exitCode).toBe(0);
    expect(failed.stdout).toBe("{}\n");
    expect(failed.stderr).toContain("Store unavailable");
  });
});

describe("omp shell and child hint consumers", () => {
  const services: HookServiceOverrides = {
    list: {
      async listPackDetails() {
        throw new Error("shell and read-hints must not read the Store");
      },
    },
    storageRoot: { rootPath: "/unused" },
    platform: "linux",
    agentHookSettings: async () => DEFAULT_AGENT_HOOK_SETTINGS,
  };

  test.each(["lore get sample.read", "/usr/local/bin/lore get sample.read", "echo lore"])(
    "default lore-only associates %s",
    async (command) => {
      const result = await invoke(
        JSON.stringify({ event: "shell", sessionId: "actual-session", command }),
        services,
      );
      const response = JSON.parse(result.stdout);
      expect(result.stderr).toBe("");
      expect(response.command).toBe(
        "export LORELUM_HOST_KEY='omp'\nexport LORELUM_HOST_SESSION_ID='actual-session'\n" +
          command,
      );
    },
  );

  test.each(["git status", "lore-dev get sample.read", "explore sample", ""])(
    "empty response preserves non-lore command %s",
    async (command) => {
      const result = await invoke(
        JSON.stringify({ event: "shell", sessionId: "actual-session", command }),
        services,
      );
      expect(result.stdout).toBe("{}\n");
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).command ?? command).toBe(command);
    },
  );

  test.skipIf(process.platform === "win32")(
    "all-shell associates arbitrary commands and safely quotes the actual identity",
    async () => {
      const sessionId = "parent'$(printf injected); child";
      const command = 'printf "%s\\n%s" "$LORELUM_HOST_KEY" "$LORELUM_HOST_SESSION_ID"';
      const result = await invoke(JSON.stringify({ event: "shell", sessionId, command }), {
        ...services,
        agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
      });
      const response = JSON.parse(result.stdout);
      expect(response.command.endsWith(command)).toBe(true);
      const execution = spawnSync("/bin/sh", ["-c", response.command], { encoding: "utf8" });
      expect(execution.status).toBe(0);
      expect(execution.stderr).toBe("");
      expect(execution.stdout).toBe(`omp\n${sessionId}`);
    },
  );
  test.each([
    [
      "darwin",
      "export LORELUM_HOST_KEY=\u0027omp\u0027\nexport LORELUM_HOST_SESSION_ID=\u0027actual-session\u0027\n",
    ],
    [
      "linux",
      "export LORELUM_HOST_KEY=\u0027omp\u0027\nexport LORELUM_HOST_SESSION_ID=\u0027actual-session\u0027\n",
    ],
    [
      "win32",
      "$env:LORELUM_HOST_KEY = \u0027omp\u0027\n$env:LORELUM_HOST_SESSION_ID = \u0027actual-session\u0027\n",
    ],
  ] as const)(
    "%s prefixes the shell command with the host shell syntax",
    async (platform, prefix) => {
      const command = "lore get sample.read";
      const result = await invoke(
        JSON.stringify({ event: "shell", sessionId: "actual-session", command }),
        {
          ...services,
          platform,
          agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
        },
      );
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).command).toBe(prefix + command);
    },
  );

  test.skipIf(process.platform !== "win32")(
    "Windows PowerShell rewrite passes session identity without changing exit status",
    async () => {
      const sessionId = "parent\u0027one";
      const command = 'echo "$env:LORELUM_HOST_KEY/$env:LORELUM_HOST_SESSION_ID"; exit 23';
      const result = await invoke(JSON.stringify({ event: "shell", sessionId, command }), {
        ...services,
        platform: "win32",
        agentHookSettings: async () => ({ shellSessionInjection: "all-shell" }),
      });
      const response = JSON.parse(result.stdout);
      expect(response.command.endsWith(command)).toBe(true);
      const execution = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", response.command],
        { encoding: "utf8" },
      );
      expect(execution.status).toBe(23);
      expect(execution.stdout.trim()).toBe("omp/" + sessionId);
    },
  );

  test.each([
    { event: "shell", sessionId: "../outside", command: "lore get sample.read" },
    { event: "shell", sessionId: "", command: "lore get sample.read" },
    { event: "shell", sessionId: "parent", command: 1 },
    { event: "shell", sessionId: "parent" },
    { event: "read-hints", sessionId: "nested/session" },
    { event: "read-hints", sessionId: "nested\\session" },
    { event: "read-hints", sessionId: "." },
    { event: "read-hints", sessionId: "\0" },
    { event: "read-hints", sessionId: "x".repeat(121) },
    { event: "read-hints", sessionId: "\ud800" },
    { event: "read-hints", sessionId: 1 },
    { event: "read-hints", sessionId: "parent", hostKey: "codex" },
    { event: "catalog", command: "lore get sample.read" },
    { event: "PostToolUse", sessionId: "parent" },
  ])("rejects invalid bridge request %j before invoking services", async (payload) => {
    const result = await invoke(JSON.stringify(payload), {
      ...services,
      agentHookSettings: async () => {
        throw new Error("settings must not be called");
      },
      practiceHints: {
        readRecentHints: async () => {
          throw new Error("hints must not be called");
        },
      },
    });
    expect(result.stdout).toBe("{}\n");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("valid catalog, shell, or read-hints request");
    expect(result.stderr).not.toContain("must not be called");
  });

  test("returns bounded candidate metadata for the exact parent, never full guidance", async () => {
    const calls: unknown[] = [];
    const result = await invoke('{"event":"read-hints","sessionId":"direct-parent"}', {
      ...services,
      practiceHints: {
        async readRecentHints(hostKey, sessionId) {
          calls.push([hostKey, sessionId]);
          return Array.from({ length: 50 }, (_, index) => ({
            id: `sample.read-${index}`,
            digest: "private-digest",
            title: "Read candidate",
            appliesWhen: "When considering boundaries",
          }));
        },
      },
    });
    expect(calls).toEqual([["omp", "direct-parent"]]);
    expect(result.stderr).toBe("");
    const response = JSON.parse(result.stdout);
    expect(Object.keys(response)).toEqual(["additionalContext"]);
    expect(response.additionalContext.length).toBeLessThanOrEqual(1800);
    expect(response.additionalContext).toContain("sample.read-0");
    expect(response.additionalContext).toContain("When considering boundaries");
    expect(response.additionalContext).toContain("not adopted guidance");
    expect(response.additionalContext).toContain("lore get <practice-id>");
    expect(response.additionalContext).not.toContain("private-digest");
  });

  test("empty candidates are a quiet no-op, but unavailable Backend gets diagnostics", async () => {
    const payload = '{"event":"read-hints","sessionId":"parent"}';
    const empty = await invoke(payload, {
      ...services,
      practiceHints: { readRecentHints: async () => [] },
    });
    expect(empty.stdout).toBe("{}\n");
    expect(empty.stderr).toBe("");
    const failed = await invoke(payload, {
      ...services,
      practiceHints: {
        readRecentHints: async () => {
          throw new Error("Backend unavailable");
        },
      },
    });
    expect(failed.exitCode).toBe(0);
    expect(failed.stdout).toBe("{}\n");
    expect(failed.stderr).toContain("Backend unavailable");
  });

  test("settings failure leaves the original command intact", async () => {
    const command = "lore get sample.read";
    const result = await invoke(JSON.stringify({ event: "shell", sessionId: "parent", command }), {
      ...services,
      agentHookSettings: async () => {
        throw new Error("invalid Agent settings");
      },
    });
    expect(result.stdout).toBe("{}\n");
    expect(JSON.parse(result.stdout).command ?? command).toBe(command);
    expect(result.stderr).toContain("invalid Agent settings");
  });
});

describe("omp role-scoped Pack Catalog", () => {
  test.each([
    { source: undefined, enabled: false, degraded: false },
    { source: "agent:\n  shellSessionInjection: all-shell\n", enabled: false, degraded: false },
    { source: "agent:\n  subagentPackCatalog: false\n", enabled: false, degraded: false },
    { source: "agent:\n  subagentPackCatalog: true\n", enabled: true, degraded: false },
    { source: "agent:\n  subagentPackCatalog: 'true'\n", enabled: false, degraded: true },
    { source: "agent: [\n", enabled: false, degraded: true },
  ])(
    "loads child config $source before touching Store services",
    async ({ source, enabled, degraded }) => {
      const home = await mkdtemp(join(tmpdir(), "lorelum-omp-config-"));
      try {
        if (source !== undefined) {
          await mkdir(join(home, ".lorelum"));
          await writeFile(join(home, ".lorelum", "config.yaml"), source);
        }
        let opens = 0;
        let reads = 0;
        const result = await invoke('{"event":"catalog","agentKind":"sub"}', {
          get storageRoot() {
            opens++;
            if (!enabled) throw new Error("Disabled child must not open Store");
            return { rootPath: "/catalog-store" };
          },
          get list() {
            opens++;
            if (!enabled) throw new Error("Disabled child must not open Store");
            return {
              listPackDetails: async () => {
                reads++;
                return details;
              },
            };
          },
          subagentPackCatalog: () => loadSubagentPackCatalogSetting({ homeDirectory: home }),
        });
        expect(result.exitCode).toBe(0);
        if (enabled) {
          expect(JSON.parse(result.stdout).additionalContext).toContain(
            "Lorelum Installed Pack Catalog",
          );
          expect(reads).toBe(1);
          expect(opens).toBeGreaterThan(0);
        } else {
          expect(result.stdout).toBe("{}\n");
          expect(reads).toBe(0);
          expect(opens).toBe(0);
        }
        if (degraded) expect(result.stderr).toContain("lore hook omp degraded:");
        else expect(result.stderr).toBe("");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test.each([{}, { agentKind: "main" }])(
    "main and omitted roles never consult the subagent setting: %j",
    async (role) => {
      const result = await invoke(JSON.stringify({ event: "catalog", ...role }), {
        list: { listPackDetails: async () => details },
        storageRoot: { rootPath: "/main-store" },
        subagentPackCatalog: async () => {
          throw new Error("Invalid setting must not affect Main");
        },
      });
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).additionalContext).toContain(
        "Lorelum Installed Pack Catalog",
      );
    },
  );

  test.each([
    { event: "catalog", agentKind: null },
    { event: "catalog", agentKind: false },
    { event: "catalog", agentKind: 1 },
    { event: "catalog", agentKind: "child" },
    { event: "catalog", agentKind: "sub", extra: "not part of the bridge contract" },
    { event: "shell", agentKind: "sub", sessionId: "child", command: "lore get retry" },
    { event: "read-hints", agentKind: "sub", sessionId: "parent" },
  ])("strictly rejects role misuse %j before services", async (payload) => {
    let touched = false;
    const result = await invoke(JSON.stringify(payload), {
      storageRoot: { rootPath: "/unused" },
      list: {
        listPackDetails: async () => {
          touched = true;
          return details;
        },
      },
      subagentPackCatalog: async () => {
        touched = true;
        return true;
      },
      agentHookSettings: async () => {
        touched = true;
        return DEFAULT_AGENT_HOOK_SETTINGS;
      },
      practiceHints: {
        readRecentHints: async () => {
          touched = true;
          return [];
        },
      },
    });
    expect(result.stdout).toBe("{}\n");
    expect(result.stderr).toContain("valid catalog, shell, or read-hints request");
    expect(touched).toBe(false);
  });
});
