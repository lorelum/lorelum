import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createLocalStore, decodePackDirectory, type PackCandidate } from "../src/local-store";
import { createPackCandidate } from "../src/local-store/model";
import { createQueryService } from "../src/query";
import { buildKeywordIndex } from "../src/query/keyword/keyword-index";
import { projectKeywordPractice } from "../src/query/keyword/projection";
import { measure, summarize, type LatencySummary } from "./latency";

/** Fixed-seed, variable-length synthetic data. Never reads the user's Store. */
function syntheticCandidate(count: number): PackCandidate {
  let seed = 42;
  const practices = Array.from({ length: count }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const topic = [
      "React authentication",
      "SQLite transaction",
      "中文接口请求",
      "TypeScript schema",
    ][seed % 4]!;
    return {
      id: `benchmark.practice.${i}`,
      title: `${topic} guidance ${i}`,
      stage: "implementation",
      tech_stack: ["typescript"],
      applies_when: `Working on ${topic}`,
      body: `${topic} use a focused module and test observable behavior.\n`.repeat(1 + (seed % 8)),
    };
  });
  return createPackCandidate(
    {
      pack: { name: "query-benchmark", version: "1.0.0" },
      practices,
      decisions: [],
    },
    Object.fromEntries(practices.map((p) => [p.id, `practices/${p.id}.md`])),
  ).candidate;
}

const iterations = Number(process.env.LORELUM_BENCH_ITERATIONS ?? 20);
if (!Number.isSafeInteger(iterations) || iterations < 1)
  throw new Error("Invalid benchmark iterations");
const binary = process.env.LORELUM_CLI_BINARY;
const packDirectory = process.env.LORELUM_BENCH_PACK;
const scales = (process.env.LORELUM_BENCH_SCALES ?? "100,1000,5000,20000").split(",").map(Number);
if (scales.some((n) => !Number.isSafeInteger(n) || n < 1))
  throw new Error("Invalid benchmark scales");
const text = process.env.LORELUM_BENCH_QUERY ?? "React authentication";

function report(label: string, stage: string, latency: LatencySummary): void {
  console.log(JSON.stringify({ label, stage, ...latency }));
}

async function benchmark(candidate: PackCandidate, label: string): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-keyword-benchmark-"));
  const root = { rootPath };
  const store = createLocalStore();
  try {
    await store.install(root, candidate);
    const snapshot = await store.readEffectivePractices(root);
    const documents = snapshot.map(projectKeywordPractice);
    const service = createQueryService({ store });
    report(
      label,
      "store-read",
      await measure(iterations, 2, async () => {
        await store.readEffectivePractices(root);
      }),
    );
    report(
      label,
      "projection",
      await measure(iterations, 2, () => {
        snapshot.map(projectKeywordPractice);
      }),
    );
    report(
      label,
      "tokenize-build-close",
      await measure(iterations, 2, () => {
        const index = buildKeywordIndex(documents);
        index.close();
      }),
    );
    const index = buildKeywordIndex(documents);
    try {
      report(
        label,
        "search-top-k",
        await measure(iterations, 2, () => {
          index.search(text, 5);
        }),
      );
    } finally {
      index.close();
    }
    report(
      label,
      "query-service-total",
      await measure(iterations, 2, async () => {
        await service.query(root, { text });
      }),
    );
    if (binary !== undefined) {
      const elapsed: number[] = [];
      const rss: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const child = Bun.spawn([resolve(binary), "query", text, "--store-root", rootPath], {
          stdout: "pipe",
          stderr: "pipe",
        });
        // eslint-disable-next-line no-await-in-loop -- each child is one cold-process sample
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (exit !== 0) throw new Error(`Compiled query failed: ${stderr || stdout}`);
        const response = JSON.parse(stdout);
        if (!response.ok || response.data.mode !== "keyword")
          throw new Error("Unexpected compiled query result");
        elapsed.push(performance.now() - start);
        const usage = child.resourceUsage();
        if (usage !== undefined) rss.push(usage.maxRSS);
      }
      report(label, "compiled-query", summarize(elapsed));
      console.log(
        JSON.stringify({
          label,
          stage: "compiled-peak-rss-bytes",
          samples: rss.length,
          max: rss.length ? Math.max(...rss) : null,
        }),
      );
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

console.log(
  JSON.stringify({
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    iterations,
    seed: 42,
    text,
    compiled: binary !== undefined,
  }),
);
if (packDirectory !== undefined) {
  const decoded = await decodePackDirectory(resolve(packDirectory));
  await benchmark(
    decoded.candidate,
    `public-pack:${decoded.candidate.pack.name}:${decoded.candidate.sources.length}`,
  );
} else {
  for (const count of scales) {
    // eslint-disable-next-line no-await-in-loop -- separate scales avoid competing benchmark workloads
    await benchmark(syntheticCandidate(count), String(count));
  }
}
