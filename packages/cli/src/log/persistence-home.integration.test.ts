import { expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entrypoint = join(import.meta.dir, "../main.ts");

interface CliResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

/**
 * Runs the real CLI entrypoint as a child process against an isolated HOME so
 * the production trusted-root resolution (`homedir()` → `~/.lorelum`) is
 exercised, never this machine's real `~/.lorelum`.
 */
async function runCliInHome(home: string, args: readonly string[]): Promise<CliResult> {
  const child = Bun.spawn({
    cmd: [process.execPath, entrypoint, ...args],
    env: { ...process.env, HOME: home },
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function fixture(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "lorelum-home-guard-"));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function fullMode(mode: number): number {
  return mode & 0o7777;
}

function envelopeWithoutTrace(stdout: string): Record<string, unknown> {
  const { diagnostics, ...rest } = JSON.parse(stdout) as {
    diagnostics: { traceId: string };
  } & Record<string, unknown>;
  const { traceId: _traceId, ...diagnosticsRest } = diagnostics;
  return { ...rest, diagnostics: diagnosticsRest };
}

test.skipIf(process.platform === "win32")(
  "a user-owned 0755 Lorelum root persists private trace logs without disturbing HOME",
  async () =>
    fixture(async (home) => {
      await mkdir(join(home, ".lorelum"), { mode: 0o755 });
      const homeBefore = fullMode((await stat(home)).mode);
      const rootBefore = fullMode((await lstat(join(home, ".lorelum"))).mode);

      const failed = await runCliInHome(home, ["query", "   ", "--json"]);
      expect(failed.exitCode).toBe(2);
      expect(failed.stderr).toBe("");
      const envelope = JSON.parse(failed.stdout) as {
        diagnostics: { traceId: string };
        ok: boolean;
        error: { code: string };
      };
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("usage.invalid");

      // Guard: neither HOME nor the 0755 Lorelum root changed by a single bit.
      expect(fullMode((await stat(home)).mode)).toBe(homeBefore);
      expect(fullMode((await lstat(join(home, ".lorelum"))).mode)).toBe(rootBefore);
      expect(rootBefore & 0o777).toBe(0o755);

      const cliDirectory = join(home, ".lorelum", "logs", "cli");
      const [daySegment] = await readdir(cliDirectory);
      if (daySegment === undefined) throw new Error("Expected one day segment directory.");
      const segmentFile = join(cliDirectory, daySegment, `${envelope.diagnostics.traceId}.jsonl`);
      expect(fullMode((await lstat(join(home, ".lorelum", "logs"))).mode) & 0o777).toBe(0o700);
      expect(fullMode((await lstat(cliDirectory)).mode) & 0o777).toBe(0o700);
      expect(fullMode((await lstat(join(cliDirectory, daySegment))).mode) & 0o777).toBe(0o700);
      expect(fullMode((await lstat(segmentFile)).mode) & 0o777).toBe(0o600);

      const readBack = await runCliInHome(home, [
        "logs",
        "--trace-id",
        envelope.diagnostics.traceId,
        "--json",
      ]);
      expect(readBack.exitCode).toBe(0);
      expect(readBack.stderr).toBe("");
      const readEnvelope = JSON.parse(readBack.stdout) as {
        ok: boolean;
        data: { records: unknown[] };
      };
      expect(readEnvelope.ok).toBe(true);
      expect(readEnvelope.data.records.length).toBeGreaterThan(0);
    }),
);

test.skipIf(process.platform === "win32")(
  "an unusable Lorelum root leaves the business result and HOME untouched",
  async () => {
    const homes = {
      broken: await mkdtemp(join(tmpdir(), "lorelum-home-guard-")),
      healthy: await mkdtemp(join(tmpdir(), "lorelum-home-guard-")),
    };
    try {
      const redirected = join(homes.broken, "elsewhere");
      await mkdir(redirected, { mode: 0o700 });
      await writeFile(join(redirected, "sentinel"), "preserve me", "utf8");
      await symlink(redirected, join(homes.broken, ".lorelum"));
      await mkdir(join(homes.healthy, ".lorelum"), { mode: 0o755 });
      const modesBefore = {
        broken: fullMode((await stat(homes.broken)).mode),
        healthy: fullMode((await stat(homes.healthy)).mode),
      };

      const broken = await runCliInHome(homes.broken, ["query", "   ", "--json"]);
      const healthy = await runCliInHome(homes.healthy, ["query", "   ", "--json"]);

      expect(broken.exitCode).toBe(healthy.exitCode);
      expect(broken.exitCode).toBe(2);
      expect(envelopeWithoutTrace(broken.stdout)).toEqual(envelopeWithoutTrace(healthy.stdout));
      expect(healthy.stderr).toBe("");
      const lines = broken.stderr.split("\n").filter((line) => line !== "");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("diagnostic logs for this run were not saved");
      expect(lines[0]).toContain("symlink at ");
      expect(lines[0]).toContain(join(homes.broken, ".lorelum"));

      expect(fullMode((await stat(homes.broken)).mode)).toBe(modesBefore.broken);
      expect(fullMode((await stat(homes.healthy)).mode)).toBe(modesBefore.healthy);
      expect(await readFile(join(redirected, "sentinel"), "utf8")).toBe("preserve me");
    } finally {
      await Promise.all(
        Object.values(homes).map((home) => rm(home, { recursive: true, force: true })),
      );
    }
  },
);
