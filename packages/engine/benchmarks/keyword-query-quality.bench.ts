import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reactPack } from "@lorelum/format";
import { createLocalStore, decodePackDirectory } from "../src/local-store";
import { createPackCandidate } from "../src/local-store/model";
import { createQueryService } from "../src/query";

interface QueryCase {
  readonly text: string;
  readonly relevant: readonly string[];
  readonly forbidden?: readonly string[];
  readonly group: "lexical" | "scope" | "cross-language";
}

// Tiny hand-labeled diagnostic sets, not production relevance judgments.
const fixtureCases: readonly QueryCase[] = [
  { text: "axios", relevant: ["react.api.layered-design"], group: "lexical" },
  { text: "Redux", relevant: ["react.state.redux"], group: "lexical" },
  { text: "route guard authentication", relevant: ["react.auth.guard"], group: "lexical" },
  { text: "localStorage", relevant: ["react.api.layered-design"], group: "lexical" },
  { text: "DTO boundary", relevant: ["react.api.layered-design"], group: "lexical" },
  { text: "中文接口请求", relevant: ["example.api.chinese"], group: "lexical" },
  { text: "认证路由保护", relevant: ["react.auth.guard"], group: "cross-language" },
];
const publicPackCases: readonly QueryCase[] = [
  {
    text: "Reuse existing capability before building a new abstraction",
    relevant: ["agentic-coding.implementation.inspect-and-reuse-existing-capability"],
    group: "lexical",
  },
  {
    text: "Classify a failing test before editing expectations",
    relevant: ["agentic-coding.testing.classify-failure-before-changing-test"],
    group: "lexical",
  },
  {
    text: "Write a checkpoint preserving decisions for a handoff",
    relevant: ["agentic-coding.context.write-decision-dense-checkpoint"],
    group: "lexical",
  },
  {
    text: "Report only outcomes supported by evidence",
    relevant: ["agentic-coding.delivery.claim-only-supported-outcome"],
    group: "lexical",
  },
  {
    text: "Review findings only; do not redesign the implementation",
    relevant: ["agentic-coding.review.validate-findings-before-action"],
    forbidden: ["agentic-coding.implementation.choose-smallest-sufficient-design"],
    group: "scope",
  },
  {
    text: "先判断测试为什么失败，不要直接修改断言",
    relevant: ["agentic-coding.testing.classify-failure-before-changing-test"],
    group: "cross-language",
  },
];

const rootPath = await mkdtemp(join(tmpdir(), "lorelum-query-quality-"));
try {
  const root = { rootPath };
  const store = createLocalStore();
  const packDirectory = process.env.LORELUM_BENCH_PACK;
  let cases = fixtureCases;
  if (packDirectory !== undefined) {
    const decoded = await decodePackDirectory(resolve(packDirectory));
    if (decoded.candidate.pack.name !== "agentic-coding")
      throw new Error("Public quality cases require the agentic-coding Pack");
    await store.install(root, decoded.candidate);
    cases = publicPackCases;
  } else {
    const input = reactPack();
    input.practices.push({
      id: "example.api.chinese",
      title: "中文接口请求",
      stage: "api",
      tech_stack: ["typescript"],
      applies_when: "处理中文接口请求的错误",
      body: "接口请求失败时显示明确错误。",
    });
    await store.install(
      root,
      createPackCandidate(
        input,
        Object.fromEntries(input.practices.map((p) => [p.id, `practices/${p.id}.md`])),
      ).candidate,
    );
  }
  const knownIds = new Set((await store.readEffectivePractices(root)).map((p) => p.practiceId));
  const service = createQueryService({ store });
  const rows = [];
  for (const item of cases) {
    if ([...item.relevant, ...(item.forbidden ?? [])].some((id) => !knownIds.has(id)))
      throw new Error("Evaluation labels do not match the Pack revision");
    // eslint-disable-next-line no-await-in-loop -- emit each independently evaluated request in case order
    const result = await service.query(root, { text: item.text, limit: 5 });
    const ids = result.results.map((hit) => hit.practiceId);
    const rank = ids.findIndex((id) => item.relevant.includes(id));
    const hits = ids.filter((id) => item.relevant.includes(id)).length;
    const dcg = ids.reduce(
      (sum, id, i) => sum + (item.relevant.includes(id) ? 1 / Math.log2(i + 2) : 0),
      0,
    );
    const ideal = item.relevant
      .slice(0, 5)
      .reduce((sum, unused, i) => sum + 1 / Math.log2(i + 2), 0);
    const row = {
      group: item.group,
      text: item.text,
      ids,
      recallAt5: hits / item.relevant.length,
      reciprocalRankAt5: rank < 0 ? 0 : 1 / (rank + 1),
      ndcgAt5: dcg / ideal,
      scopeViolation: ids.some((id) => item.forbidden?.includes(id)),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  for (const group of ["lexical", "scope", "cross-language"] as const) {
    const selected = rows.filter((row) => row.group === group);
    if (selected.length === 0) continue;
    console.log(
      JSON.stringify({
        group,
        cases: selected.length,
        meanRecallAt5: selected.reduce((s, r) => s + r.recallAt5, 0) / selected.length,
        mrrAt5: selected.reduce((s, r) => s + r.reciprocalRankAt5, 0) / selected.length,
        meanNdcgAt5: selected.reduce((s, r) => s + r.ndcgAt5, 0) / selected.length,
        scopeViolationRate: selected.filter((r) => r.scopeViolation).length / selected.length,
      }),
    );
  }
} finally {
  await rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
