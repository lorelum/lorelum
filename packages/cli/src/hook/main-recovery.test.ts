import { describe, expect, mock, test } from "bun:test";
import type { ReadHint } from "@lorelum/backend/client";
import type { ListPackDetailsResult } from "@lorelum/engine";
import type { HookServiceOverrides } from "./command.js";
import { invokeHook } from "./endpoint.test-helper.js";
import { renderInstalledPackCatalog } from "./pack-catalog.js";

const details: ListPackDetailsResult = {
  generation: 1,
  effectiveRevision: 1,
  packs: [{ name: "engineering", version: "1.0.0", packRoot: "/store/engineering" }],
};
const hint: ReadHint = {
  id: "engineering.review-boundaries",
  title: "Review changed boundaries",
  appliesWhen: "Before applying a change",
  digest: "historical-private-digest",
};

async function invoke(
  host: "codex" | "claude" | "workbuddy" | "zcode" | "cursor",
  payload: Record<string, unknown>,
  overrides: Partial<HookServiceOverrides> = {},
) {
  let stdout = "";
  let stderr = "";
  await invokeHook(host, {
    stdin: { text: async () => JSON.stringify(payload) },
    stdout: {
      write: (text) => {
        stdout += text;
      },
    },
    stderr: {
      write: (text) => {
        stderr += text;
      },
    },
    services: {
      list: { listPackDetails: async () => details },
      storageRoot: { rootPath: "/isolated-store" },
      autoUpdate: { poll: async () => undefined },
      ...overrides,
    },
  });
  const response = JSON.parse(stdout) as {
    hookSpecificOutput?: { hookEventName: string; additionalContext: string };
    additional_context?: string;
  };
  return { response, stderr };
}

for (const host of ["codex", "claude", "workbuddy"] as const) {
  describe(`${host} Main compact recovery`, () => {
    test("recovers only the compact session, not startup/resume or another conversation", async () => {
      const readRecentHints = mock(async (_host: string, session: string) =>
        session === "current-session" ? [hint] : [],
      );
      const poll = mock(async () => undefined);
      const services = { practiceHints: { readRecentHints }, autoUpdate: { poll } };
      const ordinary = await Promise.all(
        ["startup", "resume", "clear", "fork"].map((source) =>
          invoke(
            host,
            {
              hook_event_name: "SessionStart",
              source,
              session_id: "current-session",
            },
            services,
          ),
        ),
      );
      for (const { response } of ordinary) {
        expect(response.hookSpecificOutput?.additionalContext).toBe(
          renderInstalledPackCatalog(details),
        );
      }
      expect(readRecentHints).not.toHaveBeenCalled();
      expect(poll).toHaveBeenCalledTimes(2);
      const { response, stderr } = await invoke(
        host,
        {
          hook_event_name: "SessionStart",
          source: "compact",
          session_id: "current-session",
        },
        services,
      );
      expect(stderr).toBe("");
      expect(response.hookSpecificOutput?.hookEventName).toBe("SessionStart");
      const context = response.hookSpecificOutput!.additionalContext;
      expect(context).toContain(hint.id);
      expect(context).toContain(hint.title);
      expect(context).not.toContain(hint.digest);
      expect(context.match(/"id":"engineering\.review-boundaries"/g)).toHaveLength(1);
      expect(readRecentHints.mock.calls).toEqual([[host, "current-session"]]);
      expect(poll).toHaveBeenCalledTimes(2);

      const other = await invoke(
        host,
        {
          hook_event_name: "SessionStart",
          source: "compact",
          session_id: "other-session",
        },
        services,
      );
      expect(other.response.hookSpecificOutput?.additionalContext).toBe(
        renderInstalledPackCatalog(details),
      );
    });

    test("keeps the Catalog when candidates are absent, unavailable or identity is invalid", async () => {
      const readRecentHints = mock(async () => {
        throw new Error("Backend unavailable");
      });
      const services = { practiceHints: { readRecentHints } };
      const failed = await invoke(
        host,
        {
          hook_event_name: "SessionStart",
          source: "compact",
          session_id: "current-session",
        },
        services,
      );
      expect(failed.stderr).toBe("");
      expect(failed.response.hookSpecificOutput?.additionalContext).toBe(
        renderInstalledPackCatalog(details),
      );
      const invalidResponses = await Promise.all(
        [undefined, "../other-session", 12].map((session_id) =>
          invoke(
            host,
            {
              hook_event_name: "SessionStart",
              source: "compact",
              session_id,
            },
            services,
          ),
        ),
      );
      for (const invalid of invalidResponses) {
        expect(invalid.response.hookSpecificOutput?.additionalContext).toBe(
          renderInstalledPackCatalog(details),
        );
      }
      expect(readRecentHints).toHaveBeenCalledTimes(1);
    });
  });
}

test("recovery shares the native context budget without cutting candidate records", async () => {
  const largeDetails: ListPackDetailsResult = {
    ...details,
    packs: Array.from({ length: 80 }, (_, index) => ({
      name: `pack-${index}`,
      version: "1.0.0",
      packRoot: `/store/pack-${index}`,
      description: "Routing metadata ".repeat(40),
    })),
  };
  const hints = Array.from({ length: 40 }, (_, index) => ({
    ...hint,
    id: `engineering.practice-${index}`,
    title: "A".repeat(150),
    appliesWhen: "B".repeat(150),
  }));
  const { response } = await invoke(
    "codex",
    {
      hook_event_name: "SessionStart",
      source: "compact",
      session_id: "current-session",
    },
    {
      list: { listPackDetails: async () => largeDetails },
      practiceHints: { readRecentHints: async () => hints },
    },
  );
  const context = response.hookSpecificOutput!.additionalContext;
  expect(context.length).toBeLessThanOrEqual(4000);
  expect(context).toContain("pack-0");
  expect(context).toContain("engineering.practice-0");
  expect(context).not.toContain("engineering.practice-39");
  expect(context).not.toContain(hint.digest);
  for (const line of context.split("\n").filter((entry) => entry.startsWith("- {"))) {
    const candidate = JSON.parse(line.slice(2)) as {
      id: string;
      title: string;
      appliesWhen: string;
    };
    expect(candidate.id).toMatch(/^engineering\.practice-\d+$/);
    expect(candidate.title).toBe("A".repeat(100));
    expect(candidate.appliesWhen).toBe("B".repeat(120));
  }
});

test("hosts without a post-compact entry do not recover candidates through fabricated input", async () => {
  const readRecentHints = mock(async () => [hint]);
  const responses = await Promise.all(
    (["zcode", "cursor"] as const).map((host) =>
      invoke(
        host,
        {
          hook_event_name: host === "cursor" ? "sessionStart" : "SessionStart",
          source: "compact",
          session_id: "current-session",
        },
        { practiceHints: { readRecentHints } },
      ),
    ),
  );
  for (const { response } of responses) {
    const context = response.hookSpecificOutput?.additionalContext ?? response.additional_context;
    expect(context).toBe(renderInstalledPackCatalog(details));
  }
  expect(readRecentHints).not.toHaveBeenCalled();
});
