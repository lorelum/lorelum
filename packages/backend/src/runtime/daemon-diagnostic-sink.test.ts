import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { selectDaemonDiagnosticSink } from "./daemon-diagnostic-sink";

async function fixture(
  run: (home: string, logRoot: string, fallbackRoot: string) => Promise<void>,
) {
  const home = await mkdtemp(join(tmpdir(), "lorelum-daemon-sink-"));
  const logRoot = join(home, ".lorelum", "logs");
  const fallbackRoot = join(home, ".lorelum-diagnostics");
  try {
    await run(home, logRoot, fallbackRoot);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test.skipIf(process.platform === "win32")(
  "keeps the primary location when only a rotation is widened",
  async () =>
    fixture(async (home, logRoot, fallbackRoot) => {
      const backend = join(logRoot, "backend");
      await mkdir(backend, { recursive: true, mode: 0o700 });
      await writeFile(join(backend, "current.jsonl"), "{}\n", { mode: 0o600 });
      // The chmod -R shape: only the rotated file is too wide.
      await writeFile(join(backend, "current.jsonl.1"), "{}\n", { mode: 0o644 });

      const selection = await selectDaemonDiagnosticSink(logRoot, fallbackRoot);

      expect(selection.degraded).toBe(false);
      expect(selection.fallbackUsed).toBe(false);
      expect(selection.usedDirectory).toBe(backend);
      expect((await lstat(join(backend, "current.jsonl.1"))).mode & 0o777).toBe(0o600);
    }),
);

test.skipIf(process.platform === "win32")(
  "diverts to the fallback and reports the primary failure category",
  async () =>
    fixture(async (home, logRoot, fallbackRoot) => {
      const backend = join(logRoot, "backend");
      // An unreadable 0o000 Lorelum root makes the whole primary chain
      // unrepairable without touching anything outside this sandbox.
      await mkdir(backend, { recursive: true, mode: 0o700 });
      await chmod(join(home, ".lorelum"), 0o000);

      const selection = await selectDaemonDiagnosticSink(logRoot, fallbackRoot);

      await chmod(join(home, ".lorelum"), 0o700);
      expect(selection.fallbackUsed).toBe(true);
      expect(selection.degraded).toBe(false);
      expect(selection.usedDirectory).toBe(join(fallbackRoot, "backend"));
      expect(selection.failureCategory).toBe("backend.state-invalid");
    }),
);
