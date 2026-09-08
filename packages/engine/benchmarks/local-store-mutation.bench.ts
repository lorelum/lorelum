import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { createLocalStore } from "../src/local-store";
import { createPackCandidate } from "../src/local-store/model";
import { summarize, type LatencySummary } from "./latency";
import { createTargetCandidate } from "./local-store-mutation-fixtures";

type Operation = "add" | "change" | "remove";

const operations: readonly Operation[] = ["add", "change", "remove"];
const scales = (process.env.LORELUM_BENCH_SCALES ?? "1000,5000,20000").split(",").map(Number);
const iterations = Number(process.env.LORELUM_BENCH_ITERATIONS ?? 20);
const warmup = Number(process.env.LORELUM_BENCH_WARMUP ?? 3);
const runnerPath = process.env.LORELUM_MUTATION_BENCH_RUNNER;

if (scales.some((value) => !Number.isSafeInteger(value) || value < 1)) {
  throw new Error("LORELUM_BENCH_SCALES must contain positive integers");
}
if (
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  !Number.isSafeInteger(warmup) ||
  warmup < 0
) {
  throw new Error("LORELUM_BENCH_ITERATIONS and LORELUM_BENCH_WARMUP are invalid");
}
if (runnerPath === undefined || runnerPath.length === 0) {
  throw new Error("LORELUM_MUTATION_BENCH_RUNNER must name the compiled mutation runner");
}

function baseCandidate(count: number) {
  const practices = Array.from({ length: count }, (_, index) => ({
    id: `benchmark.base.${index}`,
    title: `Base Practice ${index}`,
    stage: "implementation" as const,
    tech_stack: ["typescript"],
    applies_when: "Preparing an isolated LocalStore benchmark baseline",
    body: `Base canonical Practice ${index}.\n`,
  }));
  return createPackCandidate(
    { pack: { name: "benchmark-base", version: "1.0.0" }, practices, decisions: [] },
    Object.fromEntries(practices.map((practice) => [practice.id, `practices/${practice.id}.md`])),
  ).candidate;
}

async function removeRoot(rootPath: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retry only after a failed deletion
      await rm(rootPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      // eslint-disable-next-line no-await-in-loop -- preserve the bounded retry interval
      await Bun.sleep(50);
    }
  }
}

async function prepareTemplate(
  scale: number,
  operation: Operation,
  parent: string,
): Promise<string> {
  const rootPath = join(parent, `${scale}-${operation}`);
  const store = createLocalStore();
  await store.install({ rootPath }, baseCandidate(scale));
  if (operation !== "add") {
    await store.install({ rootPath }, createTargetCandidate("1.0.0"));
  }
  return rootPath;
}

interface ChildSample {
  readonly elapsedMs: number;
  readonly maxRssBytes: number;
  readonly metrics: unknown;
}

async function runChild(template: string, operation: Operation): Promise<ChildSample> {
  const sampleParent = await mkdtemp(join(tmpdir(), "lorelum-mutation-sample-"));
  const rootPath = join(sampleParent, "store");
  try {
    await cp(template, rootPath, { recursive: true });
    const executable = isAbsolute(runnerPath!) ? runnerPath! : resolve(runnerPath!);
    // Store cloning is intentionally outside the sample. This interval is the
    // compiled runner startup plus one lifecycle mutation and JSON result.
    const startedAt = performance.now();
    const child = Bun.spawn([executable, "--root", rootPath, "--operation", operation], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new Error(`compiled ${operation} runner failed: ${stderr || stdout}`);
    const record: unknown = JSON.parse(stdout);
    if (
      typeof record !== "object" ||
      record === null ||
      !("metrics" in record) ||
      !("operation" in record) ||
      record.operation !== operation
    ) {
      throw new Error("compiled mutation runner did not emit a metrics record");
    }
    const usage = child.resourceUsage();
    if (usage === undefined)
      throw new Error("compiled mutation runner did not expose resource usage");
    return Object.freeze({
      elapsedMs: performance.now() - startedAt,
      maxRssBytes: usage.maxRSS,
      metrics: record.metrics,
    });
  } finally {
    await removeRoot(sampleParent);
  }
}

function report(
  scale: number,
  operation: Operation,
  latency: LatencySummary,
  samples: readonly ChildSample[],
): void {
  const first = samples[0];
  if (first === undefined) throw new Error("benchmark operation has no samples");
  const metricRecord = JSON.stringify(first.metrics);
  if (samples.some((sample) => JSON.stringify(sample.metrics) !== metricRecord)) {
    throw new Error(`logical metrics changed across ${scale}/${operation} samples`);
  }
  console.log(
    JSON.stringify({
      scale,
      operation,
      runner: "compiled-internal",
      ...latency,
      maxRssBytes: Math.max(...samples.map((sample) => sample.maxRssBytes)),
      logicalMetrics: first.metrics,
    }),
  );
}

for (const scale of [...new Set(scales)].sort((left, right) => left - right)) {
  // eslint-disable-next-line no-await-in-loop -- templates are intentionally isolated by scale
  const templateParent = await mkdtemp(join(tmpdir(), "lorelum-mutation-template-"));
  try {
    for (const operation of operations) {
      // eslint-disable-next-line no-await-in-loop -- operations must not compete for disk/cache resources
      const template = await prepareTemplate(scale, operation, templateParent);
      for (let index = 0; index < warmup; index++) {
        // eslint-disable-next-line no-await-in-loop -- warmups use isolated serial child processes
        await runChild(template, operation);
      }
      const samples: ChildSample[] = [];
      for (let index = 0; index < iterations; index++) {
        // Each sample has an independently cloned Store before the timer starts.
        // eslint-disable-next-line no-await-in-loop -- concurrent samples would invalidate the measurement
        const sample = await runChild(template, operation);
        samples.push(sample);
      }
      const latency = summarize(samples.map((sample) => sample.elapsedMs));
      report(scale, operation, latency, samples);
    }
  } finally {
    // eslint-disable-next-line no-await-in-loop -- clean one scale before preparing the next
    await removeRoot(templateParent);
  }
}
