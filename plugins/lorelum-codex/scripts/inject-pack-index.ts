import type {
  HookInput,
  HookResponse,
  InstalledPackSummary,
  LorelumHookEvent,
  PackSummarySource,
} from "./types";
import { renderPackIndex } from "./render-pack-index";

const DEFAULT_CLI_COMMAND = "lore";
const DEFAULT_CLI_ARGS = ["list", "packs"] as const;
// Must stay below the `timeout` (seconds) declared in hooks/hooks.json so the
// source times out and degrades before the host kills the hook process.
export const DEFAULT_CLI_TIMEOUT_MS = 9_000;

function configuredCliArgs(): readonly string[] {
  const encoded = process.env.LORELUM_CLI_ARGS;
  if (encoded === undefined) return DEFAULT_CLI_ARGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("LORELUM_CLI_ARGS must be a JSON array of strings.");
  }
  if (!Array.isArray(parsed) || parsed.some((argument) => typeof argument !== "string")) {
    throw new Error("LORELUM_CLI_ARGS must be a JSON array of strings.");
  }
  return Object.freeze([...parsed]);
}

function isHookEvent(value: string | undefined): value is LorelumHookEvent {
  return value === "SessionStart" || value === "PostCompact";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSummary(value: unknown): InstalledPackSummary | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.version !== "string" ||
    !Array.isArray(value.appliesTo) ||
    value.appliesTo.some((item) => typeof item !== "string")
  ) {
    return undefined;
  }
  return {
    name: value.name,
    version: value.version,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    appliesTo: value.appliesTo,
  };
}

export function parsePackSummaryEnvelope(value: unknown): readonly InstalledPackSummary[] {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
    throw new Error("Lorelum metadata command returned an invalid success envelope.");
  }
  const packs = value.data.packs;
  if (!Array.isArray(packs)) {
    throw new Error("Lorelum metadata command returned an invalid Pack list.");
  }
  const summaries: InstalledPackSummary[] = [];
  for (const pack of packs) {
    const summary = parseSummary(pack);
    if (summary === undefined) {
      throw new Error("Lorelum metadata command returned an invalid Pack summary.");
    }
    summaries.push(summary);
  }
  return Object.freeze(summaries);
}

export function createCliPackSummarySource(
  options: {
    readonly command?: string;
    readonly args?: readonly string[];
    readonly cwd?: string;
    readonly timeoutMs?: number;
  } = {},
): PackSummarySource {
  const command = options.command ?? process.env.LORELUM_CLI_COMMAND ?? DEFAULT_CLI_COMMAND;
  const args = options.args ?? configuredCliArgs();
  return {
    async readInstalledPackSummaries() {
      const processHandle = Bun.spawn([command, ...args], {
        cwd: options.cwd,
        stdout: "pipe",
        stderr: "pipe",
        timeout: options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
        processHandle.exited,
      ]);
      if (exitCode !== 0) {
        const detail = stderr.trim();
        throw new Error(
          `Lorelum metadata command failed with exit code ${exitCode}${detail === "" ? "." : `: ${detail}`}`,
        );
      }
      return parsePackSummaryEnvelope(JSON.parse(stdout));
    },
  };
}

export function buildHookResponse(
  eventName: LorelumHookEvent,
  additionalContext: string,
): HookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  };
}

export async function createHookResponse(
  input: HookInput,
  source: PackSummarySource,
): Promise<HookResponse> {
  if (!isHookEvent(input.hook_event_name)) {
    throw new Error("Lorelum hook received an unsupported event.");
  }
  const summaries = await source.readInstalledPackSummaries();
  return buildHookResponse(input.hook_event_name, renderPackIndex(summaries));
}

async function readHookInput(): Promise<HookInput> {
  const parsed: unknown = JSON.parse(await Bun.stdin.text());
  if (!isRecord(parsed)) throw new Error("Lorelum hook input must be a JSON object.");
  return parsed as HookInput;
}

async function main(): Promise<void> {
  try {
    const input = await readHookInput();
    const response = await createHookResponse(input, createCliPackSummarySource());
    process.stdout.write(JSON.stringify(response) + "\n");
  } catch (error) {
    process.stderr.write(
      `lorelum-codex hook degraded: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stdout.write(JSON.stringify({ continue: true }) + "\n");
  }
}

if (import.meta.main) {
  await main();
}
