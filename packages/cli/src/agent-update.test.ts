import { expect, test } from "bun:test";
import { run } from "./main.js";
import { commandRegistry, type CommandDefinition } from "./registry.js";
import { protocolResponseSchema } from "./output/protocol.js";
import { validateProtocolSchema } from "./output/protocol-schema.test-helper.js";

const session = { LORELUM_HOST_KEY: "codex", LORELUM_HOST_SESSION_ID: "update-session" };
const prompt = "Lorelum update available. Finish the current task before mentioning it.";

function fixtureRegistry(failed = false): readonly CommandDefinition[] {
  return commandRegistry.map((definition) =>
    definition.name === "query"
      ? {
          ...definition,
          handler: async ({ options }) => {
            if (failed) throw new Error("fixture command failed");
            return {
              data: { mode: options.mode === "keyword" ? "keyword" : "semantic", results: [] },
              textRenderer: () => "Complete query result",
            };
          },
        }
      : definition,
  );
}

async function invoke(
  args: string[],
  environment: Readonly<Record<string, string | undefined>> = session,
  failed = false,
) {
  let stdout = "";
  let stderr = "";
  const deliveries: boolean[] = [];
  const code = await run(args, {
    registry: fixtureRegistry(failed),
    environment,
    autoUpdate: {
      async poll(deliver) {
        deliveries.push(deliver);
        return deliver ? prompt : undefined;
      },
    },
    stdout: {
      write(value) {
        stdout += value;
      },
    },
    stderr: {
      write(value) {
        stderr += value;
      },
    },
  });
  return { code, stdout, stderr, deliveries };
}

test("Agent-bound text keeps the full command response and attaches one local prompt", async () => {
  const result = await invoke(["query", "fixture"]);
  expect(result).toEqual({
    code: 0,
    stdout: `Complete query result\n\n${prompt}\n`,
    stderr: "",
    deliveries: [true],
  });
});

test("Agent-bound JSON can schedule a check without consuming or changing the envelope", async () => {
  const result = await invoke(["query", "fixture", "--json"]);
  expect(result.code).toBe(0);
  expect(result.deliveries).toEqual([false]);
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  const response = JSON.parse(result.stdout);
  expect(response.data).toEqual({ mode: "semantic", results: [] });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(result.stdout).not.toContain(prompt);
  expect(result.stderr).toBe("");
});

test.each([
  {},
  { LORELUM_HOST_KEY: "codex" },
  { LORELUM_HOST_KEY: "unknown", LORELUM_HOST_SESSION_ID: "session" },
  { LORELUM_HOST_KEY: "codex", LORELUM_HOST_SESSION_ID: "../invalid" },
])(
  "unassociated or invalid sessions never touch automatic update state: %j",
  async (environment) => {
    const result = await invoke(["query", "fixture"], environment);
    expect(result.deliveries).toEqual([]);
    expect(result.stdout).toBe("Complete query result\n");
  },
);

test.each([
  { args: ["--version"] },
  { args: ["--help"] },
  { args: ["query", "--help"] },
  { args: ["describe", "query"] },
  { args: ["query", "fixture", "--invalid-option"] },
])("version, help, discovery and invalid calls never poll updates: %j", async ({ args }) => {
  const result = await invoke([...args]);
  expect(result.deliveries).toEqual([]);
  expect(result.stdout).not.toContain(prompt);
  expect(result.stderr).not.toContain(prompt);
});

test("failed retrieval preserves its error and does not consume a reminder", async () => {
  const result = await invoke(["query", "fixture"], session, true);
  expect(result.code).toBe(2);
  expect(result.deliveries).toEqual([]);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain(prompt);
});

test("explicit keyword retrieval stays offline even in a bound Agent session", async () => {
  const result = await invoke(["query", "fixture", "--mode", "keyword"]);
  expect(result.code).toBe(0);
  expect(result.deliveries).toEqual([]);
  expect(result.stdout).toBe("Complete query result\n");
  expect(result.stderr).toBe("");
});
