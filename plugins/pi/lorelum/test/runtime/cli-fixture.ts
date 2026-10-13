import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Unique token the fixture returns inside `additionalContext`. The harness looks
 * for it at the provider request to prove exactly one Catalog per conversation
 * request. Request classification independently observes Pi's context event.
 */
export const CATALOG_MARKER = "MARKER_CATALOG_PI_TASK_4_1";

export interface LoreCliFixture {
  /** Directory to prepend to `PATH` so the adapter's bare `lore` resolves here. */
  readonly binDir: string;
  readonly logPath: string;
  /** One entry per `lore` invocation, in order; the payload is the stdin JSON. */
  invocations(): readonly string[];
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

interface FixtureBehaviour {
  /** Exit code the fixture returns. Non-zero drives the adapter's degrade path. */
  readonly exitCode?: number;
  /** Raw stdout instead of the Catalog envelope, for malformed-response coverage. */
  readonly stdout?: string;
}

/**
 * Install a `lore` executable (Windows shim or POSIX launcher) that answers stdin with a
 * fixed Catalog envelope and appends each invocation (argv + stdin payload) to a
 * log file. The production adapter spawns the bare command `lore` with the
 * inherited environment, so prepending `binDir` to `PATH` intercepts it without
 * any test-only configuration surface in the Extension.
 */
export function installLoreCli(dir: string, behaviour: FixtureBehaviour = {}): LoreCliFixture {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const logPath = join(dir, "invocations.log");
  const executable = join(binDir, process.platform === "win32" ? "lore.cmd" : "lore");
  const helper = join(binDir, "fixture.cjs");
  const stdout =
    behaviour.stdout ?? JSON.stringify({ additionalContext: `Lorelum Packs: ${CATALOG_MARKER}` });
  writeFileSync(
    helper,
    [
      'const { appendFileSync } = require("node:fs");',
      'let payload = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", chunk => { payload += chunk; });',
      'process.stdin.on("end", () => {',
      `  appendFileSync(${JSON.stringify(logPath)}, process.argv.slice(2).join(" ") + "\\t" + payload + "\\n");`,
      `  process.stdout.write(${JSON.stringify(stdout)});`,
      `  process.exitCode = ${behaviour.exitCode ?? 0};`,
      "});",
      "",
    ].join("\n"),
  );
  const script =
    process.platform === "win32"
      ? `@"${process.execPath}" "${helper}" %*\r\n`
      : `#!/bin/sh\nexec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(helper)} "$@"\n`;
  writeFileSync(executable, script, "utf8");
  chmodSync(executable, 0o755);
  return {
    binDir,
    logPath,
    invocations: () => {
      try {
        return readFileSync(logPath, "utf8")
          .split("\n")
          .filter((line) => line.length > 0);
      } catch {
        return [];
      }
    },
  };
}
