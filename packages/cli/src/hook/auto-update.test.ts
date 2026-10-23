import { describe, expect, mock, test } from "bun:test";
import type { ListPackDetailsResult } from "@lorelum/engine";
import type { HookServiceOverrides } from "./command.js";
import { invokeHook } from "./endpoint.test-helper.js";
import type { HookHost, TextInput } from "./types.js";

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

const details: ListPackDetailsResult = {
  generation: 1,
  effectiveRevision: 1,
  packs: [
    {
      name: "engineering",
      version: "1.0.0",
      packRoot: "/private/pack-root",
      description: "Engineering guidance.",
      applies_to: ["typescript"],
    },
  ],
};

function input(payload: unknown): TextInput {
  return { text: async () => JSON.stringify(payload) };
}

function services(overrides: Partial<HookServiceOverrides> = {}): HookServiceOverrides {
  return {
    list: { listPackDetails: async () => details },
    storageRoot: { rootPath: "/isolated-store" },
    ...overrides,
  };
}

async function invoke(
  host: HookHost,
  payload: unknown,
  overrides: Partial<HookServiceOverrides> = {},
) {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  await invokeHook(host, {
    stdin: input(payload),
    stdout,
    stderr,
    services: services(overrides),
  });
  return { response: JSON.parse(stdout.value), stderr: stderr.value };
}

describe("asynchronous update polling in native SessionStart hooks", () => {
  for (const host of ["codex", "claude", "workbuddy", "zcode"] as const) {
    for (const source of ["startup", "resume"] as const) {
      test(`${host} polls after a successful Catalog for ${source}`, async () => {
        const poll = mock(async (_deliver: boolean) => "A Lorelum update is available.");
        const result = await invoke(
          host,
          { hook_event_name: "SessionStart", source, session_id: "parent" },
          { autoUpdate: { poll } },
        );

        expect(poll).toHaveBeenCalledTimes(1);
        expect(poll).toHaveBeenCalledWith(true);
        const additionalContext = result.response.hookSpecificOutput.additionalContext as string;
        expect(additionalContext).toContain("Engineering guidance.");
        expect(additionalContext).toEndWith("\n\nA Lorelum update is available.");
        expect(result.stderr).toBe("");
      });
    }

    test(`${host} leaves the Catalog path unchanged for missing identity or non-start/resume source`, async () => {
      const poll = mock(async () => "must not appear");
      for (const payload of [
        { hook_event_name: "SessionStart" },
        { hook_event_name: "SessionStart", source: "startup" },
        { hook_event_name: "SessionStart", source: "compact", session_id: "parent" },
        { hook_event_name: "SessionStart", source: "clear", session_id: "parent" },
        { hook_event_name: "SessionStart", source: "fork", session_id: "parent" },
        { hook_event_name: "SessionStart", source: "other", session_id: "parent" },
      ]) {
        // eslint-disable-next-line no-await-in-loop -- Each event is an independent hook process.
        const result = await invoke(host, payload, { autoUpdate: { poll } });
        expect(result.response.hookSpecificOutput.additionalContext).toContain(
          "Engineering guidance.",
        );
        expect(result.response.hookSpecificOutput.additionalContext).not.toContain(
          "must not appear",
        );
      }
      expect(poll).toHaveBeenCalledTimes(0);
    });
  }

  test.each([
    ["session id", { hook_event_name: "sessionStart", session_id: "parent" }],
    ["conversation id", { hook_event_name: "sessionStart", conversation_id: "parent" }],
  ] as const)("Cursor polls with a valid %s", async (_label, payload) => {
    const poll = mock(async () => "Cursor update notice");
    const result = await invoke("cursor", payload, { autoUpdate: { poll } });
    expect(poll).toHaveBeenCalledWith(true);
    expect(result.response.additional_context).toContain("Engineering guidance.");
    expect(result.response.additional_context).toEndWith("\n\nCursor update notice");
  });

  test("Cursor without a valid session identity keeps the Catalog and skips polling", async () => {
    const poll = mock(async () => "must not appear");
    const result = await invoke(
      "cursor",
      { hook_event_name: "sessionStart", session_id: "", conversation_id: "" },
      { autoUpdate: { poll } },
    );
    expect(poll).toHaveBeenCalledTimes(0);
    expect(result.response.additional_context).toContain("Engineering guidance.");
    expect(result.response.additional_context).not.toContain("must not appear");
  });

  test("a failed Catalog never consumes an update poll", async () => {
    const poll = mock(async () => "not delivered");
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    await invokeHook("codex", {
      stdin: input({
        hook_event_name: "SessionStart",
        source: "startup",
        session_id: "parent",
      }),
      stdout,
      stderr,
      services: services({
        list: {
          listPackDetails: async () => {
            throw new Error("Store unavailable");
          },
        },
        autoUpdate: { poll },
      }),
    });
    expect(poll).toHaveBeenCalledTimes(0);
    expect(stdout.value).toBe('{"continue":true}\n');
    expect(stderr.value).toContain("Store unavailable");
  });

  test("an auto-update error cannot degrade a successful Catalog", async () => {
    const poll = mock(async () => {
      throw new Error("auto-check unavailable");
    });
    const result = await invoke(
      "claude",
      { hook_event_name: "SessionStart", source: "resume", session_id: "parent" },
      { autoUpdate: { poll } },
    );
    expect(poll).toHaveBeenCalledTimes(1);
    expect(result.response.hookSpecificOutput.additionalContext).toContain("Engineering guidance.");
    expect(result.response.hookSpecificOutput.additionalContext).not.toContain("auto-check");
    expect(result.stderr).toBe("");
  });

  test("tool and subagent events never poll for updates", async () => {
    const poll = mock(async () => "must not appear");
    const practiceHints = { readRecentHints: async () => [] };
    for (const host of ["codex", "claude", "cursor", "workbuddy", "zcode"] as const) {
      for (const event of ["PreToolUse", "PostToolUse", "SubagentStart"] as const) {
        const payload = {
          hook_event_name: event,
          session_id: "parent",
          tool_name: "Read",
        };
        // eslint-disable-next-line no-await-in-loop -- Each hook event is an independent invocation.
        await invoke(host, payload, { autoUpdate: { poll }, practiceHints });
      }
    }
    expect(poll).toHaveBeenCalledTimes(0);
  });
});
