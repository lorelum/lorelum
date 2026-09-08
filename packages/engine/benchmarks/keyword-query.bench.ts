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
const incrementalIterations = Number(
  process.env.LORELUM_BENCH_INCREMENTAL_ITERATIONS ?? iterations,
);
if (!Number.isSafeInteger(incrementalIterations) || incrementalIterations < 1) {
  throw new Error("Invalid incremental benchmark iterations");
}
const binary = process.env.LORELUM_CLI_BINARY;
const packDirectory = process.env.LORELUM_BENCH_PACK;
const scales = (process.env.LORELUM_BENCH_SCALES ?? "100,1000,5000,20000").split(",").map(Number);
if (scales.some((n) => !Number.isSafeInteger(n) || n < 1))
  throw new Error("Invalid benchmark scales");
const text = process.env.LORELUM_BENCH_QUERY ?? "React authentication";

function report(label: string, stage: string, latency: LatencySummary): void {
  console.log(JSON.stringify({ label, stage, ...latency }));
}

function incrementalCandidate(
  index: number,
  contentVersion: number,
): {
  readonly candidate: PackCandidate;
  readonly practiceId: string;
  readonly queryText: string;
} {
  const practiceId = `benchmark.incremental.${index}`;
  const queryText = `incremental-index-marker-${index}-v${contentVersion}`;
  const candidate = createPackCandidate(
    {
      pack: { name: `query-incremental-${index}`, version: `1.0.${contentVersion}` },
      practices: [
        {
          id: practiceId,
          title: `Incremental index ${index}`,
          stage: "implementation",
          tech_stack: ["typescript"],
          applies_when: queryText,
          body: queryText,
        },
      ],
      decisions: [],
    },
    { [practiceId]: `practices/incremental-${index}.md` },
  ).candidate;
  return Object.freeze({ candidate, practiceId, queryText });
}

async function measureIncrementalIndex(
  label: string,
  root: { readonly rootPath: string },
  store: ReturnType<typeof createLocalStore>,
  service: ReturnType<typeof createQueryService>,
): Promise<void> {
  const installSamples: number[] = [];
  const upgradeSamples: number[] = [];
  const uninstallSamples: number[] = [];
  const updateSamples: number[] = [];
  const upgradeUpdateSamples: number[] = [];
  const uninstallUpdateSamples: number[] = [];
  const reuseSamples: number[] = [];
  for (let index = 0; index < incrementalIterations; index++) {
    const incremental = incrementalCandidate(index, 0);
    let startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- each mutation creates the next index revision.
    await store.install(root, incremental.candidate);
    installSamples.push(performance.now() - startedAt);

    startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- this query consumes exactly the revision above.
    const updated = await service.query(root, { text: incremental.queryText, limit: 1 });
    updateSamples.push(performance.now() - startedAt);
    if (updated.results[0]?.practiceId !== incremental.practiceId) {
      throw new Error("Incremental query did not return the just-installed Practice");
    }

    startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- the second query measures the resulting steady state.
    await service.query(root, { text: incremental.queryText, limit: 1 });
    reuseSamples.push(performance.now() - startedAt);

    const upgradedIncremental = incrementalCandidate(index, 1);
    startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- each mutation creates the next index revision.
    await store.upgrade(root, upgradedIncremental.candidate);
    upgradeSamples.push(performance.now() - startedAt);

    startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- this query consumes the upgrade revision.
    const upgraded = await service.query(root, { text: upgradedIncremental.queryText, limit: 1 });
    upgradeUpdateSamples.push(performance.now() - startedAt);
    if (upgraded.results[0]?.practiceId !== upgradedIncremental.practiceId) {
      throw new Error("Incremental query did not return the upgraded Practice");
    }

    startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- each mutation creates the next index revision.
    await store.uninstall(root, upgradedIncremental.candidate.pack.name);
    uninstallSamples.push(performance.now() - startedAt);

    startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- this query consumes the invalidation revision.
    const uninstalled = await service.query(root, {
      text: upgradedIncremental.queryText,
      limit: 1,
    });
    uninstallUpdateSamples.push(performance.now() - startedAt);
    if (
      uninstalled.results.some((result) => result.practiceId === upgradedIncremental.practiceId)
    ) {
      throw new Error("Incremental query retained an uninstalled Practice");
    }
  }
  report(label, "incremental-install", summarize(installSamples));
  report(label, "incremental-upgrade", summarize(upgradeSamples));
  report(label, "incremental-uninstall", summarize(uninstallSamples));
  report(label, "query-delta-update", summarize(updateSamples));
  report(label, "query-delta-after-upgrade", summarize(upgradeUpdateSamples));
  report(label, "query-delta-after-uninstall", summarize(uninstallUpdateSamples));
  report(label, "query-delta-reuse", summarize(reuseSamples));
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
      "query-first-build",
      await measure(iterations, 0, async () => {
        await rm(join(rootPath, "indexes"), { recursive: true, force: true });
        await service.query(root, { text });
      }),
    );
    // Build once before timing the cross-process-reusable steady state.
    await service.query(root, { text });
    report(
      label,
      "query-reuse",
      await measure(iterations, 2, async () => {
        await service.query(root, { text });
      }),
    );
    await measureIncrementalIndex(label, root, store, service);
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
    incrementalIterations,
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
