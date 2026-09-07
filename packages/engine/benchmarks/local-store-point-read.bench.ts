import { measure, type LatencySummary } from "./latency";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { createLocalStore } from "../src/local-store";
import { createPackCandidate } from "../src/local-store/model";
import { openStoreDatabase } from "../src/local-store/storage/sqlite/database";
import { readPractice } from "../src/local-store/storage/sqlite/practice-reader";
import { readStoreMetadata } from "../src/local-store/storage/sqlite/snapshot-reader";

interface BenchmarkOptions {
  readonly scales: readonly number[];
  readonly iterations: number;
  readonly fullReadIterations: number;
  readonly warmup: number;
  readonly cliBinary: string | undefined;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer; received ${value}`);
  }
  return parsed;
}

function parseOptions(argv: readonly string[]): BenchmarkOptions {
  let scales = [100, 1_000, 5_000];
  let iterations = 30;
  let fullReadIterations = 10;
  let warmup = 5;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--scales" && value !== undefined) {
      scales = value.split(",").map((item) => parsePositiveInteger(item, "--scales"));
      index += 1;
    } else if (flag === "--iterations" && value !== undefined) {
      iterations = parsePositiveInteger(value, flag);
      index += 1;
    } else if (flag === "--full-read-iterations" && value !== undefined) {
      fullReadIterations = parsePositiveInteger(value, flag);
      index += 1;
    } else if (flag === "--warmup" && value !== undefined) {
      warmup = parsePositiveInteger(value, flag);
      index += 1;
    } else {
      throw new Error(
        `Unknown or incomplete argument ${flag}. Supported: --scales, --iterations, --full-read-iterations, --warmup.`,
      );
    }
  }
  return {
    scales: Object.freeze([...new Set(scales)].sort((left, right) => left - right)),
    iterations,
    fullReadIterations,
    warmup,
    cliBinary: process.env.LORELUM_CLI_BINARY,
  };
}

function createScaleCandidate(count: number) {
  const practices = Array.from({ length: count }, (_, index) => ({
    id: `scale.practice.${index}`,
    title: `Practice ${index}`,
    stage: "api" as const,
    tech_stack: ["typescript"],
    applies_when: "benchmarking LocalStore point reads",
    severity: "warn" as const,
    body: `Guidance for Practice ${index}.\n`,
  }));
  const sourcePaths = Object.fromEntries(
    practices.map((practice) => [practice.id, `practices/scale/${practice.id}.md`]),
  );
  return createPackCandidate(
    { pack: { name: "benchmark", version: "1.0.0" }, practices, decisions: [] },
    sourcePaths,
  ).candidate;
}

function printResult(scale: number, name: string, result: LatencySummary): void {
  console.log(
    `${scale}\t${name}\tn=${result.samples}\tp50=${result.p50Ms.toFixed(2)}ms\tp95=${result.p95Ms.toFixed(2)}ms\tmean=${result.meanMs.toFixed(2)}ms`,
  );
}

async function runCompiledCli(binary: string, args: readonly string[]): Promise<void> {
  const executable = isAbsolute(binary) ? binary : join(process.cwd(), binary);
  const child = Bun.spawn([executable, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`compiled CLI exited ${exitCode}`);
}

async function removeRoot(rootPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- cleanup retries must run sequentially
      await rm(rootPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      // eslint-disable-next-line no-await-in-loop -- retries must back off serially
      await Bun.sleep(50);
    }
  }
}

async function benchmarkScale(scale: number, options: BenchmarkOptions): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-point-read-benchmark-"));
  const root = { rootPath };
  const practiceId = `scale.practice.${Math.floor(scale / 2)}`;
  const store = createLocalStore();
  try {
    await store.install(root, createScaleCandidate(scale));
    const database = await openStoreDatabase(rootPath);
    try {
      const metadata = readStoreMetadata(database);
      if (metadata === undefined) throw new Error("benchmark Store did not persist metadata");
      const sqlPoint = database.query(
        "SELECT practice_id FROM effective_practices WHERE practice_id = ?",
      );

      printResult(
        scale,
        "sql-primary-key",
        await measure(options.iterations, options.warmup, () => {
          if (sqlPoint.get(practiceId) === null) throw new Error("benchmark Practice disappeared");
        }),
      );
      printResult(
        scale,
        "sql-materialize-target",
        await measure(options.iterations, options.warmup, () => {
          if (readPractice(database, metadata, practiceId) === undefined) {
            throw new Error("benchmark Practice disappeared");
          }
        }),
      );
    } finally {
      database.close();
    }

    printResult(
      scale,
      "local-store-get",
      await measure(options.iterations, options.warmup, async () => {
        if ((await store.getEffectivePractice(root, practiceId)) === undefined) {
          throw new Error("benchmark Practice disappeared");
        }
      }),
    );
    printResult(
      scale,
      "open-then-find-baseline",
      await measure(options.fullReadIterations, options.warmup, async () => {
        const found = (await store.open(root)).effectivePractices.find(
          (practice) => practice.practiceId === practiceId,
        );
        if (found === undefined) throw new Error("benchmark Practice disappeared");
      }),
    );
    if (options.cliBinary !== undefined) {
      const binary = options.cliBinary;
      printResult(
        scale,
        "compiled-cli-version-startup",
        await measure(options.fullReadIterations, options.warmup, () =>
          runCompiledCli(binary, ["--version"]),
        ),
      );
      printResult(
        scale,
        "compiled-cli-get-startup",
        await measure(options.fullReadIterations, options.warmup, () =>
          runCompiledCli(binary, ["--store-root", rootPath, "get", practiceId]),
        ),
      );
    }
  } finally {
    await removeRoot(rootPath);
  }
}

const options = parseOptions(Bun.argv.slice(2));
console.log(
  "scale\tpath\tsamples\tp50\tp95\tmean (each scale is an isolated temporary Store; no pass/fail thresholds)",
);
if (options.cliBinary === undefined) {
  console.log(
    "compiled-cli-get-startup skipped; set LORELUM_CLI_BINARY to a compiled lore binary.",
  );
}
for (const scale of options.scales) {
  // eslint-disable-next-line no-await-in-loop -- scales intentionally run in isolated temporary roots
  await benchmarkScale(scale, options);
}
