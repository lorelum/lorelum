import { expect, test } from "bun:test";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmbeddingProfile } from "../semantic";
import { contentSemanticArtifactId, contentSemanticIndexPaths } from "./cache";
import { createIsolatedProjectSandbox } from "../../project-context/project-sandbox.test-helper";
import { resolveProjectContext } from "../../project-context/resolver";
import {
  createContentAddressedSemanticCandidateTraceService,
  createContentAddressedSemanticServices,
} from "./semantic";

const encodingId = "a".repeat(64);

async function fixture(run: (root: string, cache: string) => Promise<void>): Promise<void> {
  const [root, cache] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-project-semantic-"),
    mkdtemp(join(tmpdir(), "lorelum-project-semantic-cache-")),
  ]);
  try {
    await run(root, cache);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
}

async function writeProject(root: string): Promise<void> {
  const pack = join(root, ".lorelum", "packs", "platform");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
  await writeFile(
    join(pack, "practices", "semantic.md"),
    "---\nid: platform.semantic\ntitle: Semantic project index\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When building a content addressed semantic index.\n---\nUse one reusable local vector.\n",
  );
}

async function writeProjectCorpus(root: string, count: number): Promise<void> {
  const pack = join(root, ".lorelum", "packs", "platform");
  const practices = join(pack, "practices");
  await mkdir(practices, { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
  await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const id = "platform.semantic-" + String(index).padStart(2, "0");
      await writeFile(
        join(practices, id.slice("platform.".length) + ".md"),
        "---\nid: " +
          id +
          "\ntitle: Semantic project index " +
          index +
          "\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When building a content addressed semantic index.\n---\nUse one reusable local vector.\n",
      );
    }),
  );
}

const TASK_FIXTURE_PRACTICES = [
  {
    file: "throughput.md",
    id: "platform.throughput",
    title: "Measure throughput",
    stage: "performance",
    techStack: ["database"],
    appliesWhen: "Measure throughput during sustained traffic.",
    body: "Inspect latency and capacity.",
  },
  {
    file: "rollback.md",
    id: "platform.rollback",
    title: "Audit rollback",
    stage: "review",
    techStack: ["database"],
    appliesWhen: "Audit rollback before approving deployment.",
    body: "Inspect recovery procedures.",
  },
] as const;

async function writeTaskFixtureProject(root: string): Promise<void> {
  const pack = join(root, ".lorelum", "packs", "platform");
  const practices = join(pack, "practices");
  await mkdir(practices, { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
  for (const entry of TASK_FIXTURE_PRACTICES) {
    await writeFile(
      join(practices, entry.file),
      "---\nid: " +
        entry.id +
        "\ntitle: " +
        entry.title +
        "\nstage: " +
        entry.stage +
        "\ntech_stack:\n" +
        entry.techStack.map((value) => "  - " + value).join("\n") +
        "\napplies_when: " +
        entry.appliesWhen +
        "\n---\n" +
        entry.body +
        "\n",
    );
  }
}

/** The throughput Practice is the closer vector; final ordering must promote the task match. */
function taskFixtureVector(text: string): readonly number[] {
  if (text.includes("platform.throughput")) return [0.9, Math.sqrt(1 - 0.9 ** 2)];
  if (text.includes("platform.rollback")) {
    return [0.88, Math.sqrt(1 - 0.88 ** 2)];
  }
  return [1, 0];
}

async function snapshot(root: string) {
  const value = await resolveProjectContext({
    startDirectory: root,
    storageRoot: { rootPath: join(root, "store") },
    store: {
      async readEffectivePracticeSnapshot() {
        return { practices: [] };
      },
    },
  });
  if (value === undefined) throw new Error("Expected ProjectContext");
  return value;
}

test("builds and queries one immutable ProjectContext semantic artifact", () =>
  fixture(async (root, cache) => {
    await writeProject(root);
    const current = await snapshot(root);
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    const calls: string[][] = [];
    const services = createContentAddressedSemanticServices(current, cache, profile, {
      maxBatchSize: 8,
      async embed(inputs) {
        calls.push([...inputs]);
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    });

    await expect(services.index.build(services.root)).resolves.toMatchObject({
      status: { state: "ready", vectorCount: 1 },
    });
    const result = await services.query.query(services.root, { text: "semantic index" });
    expect(result).toMatchObject({
      mode: "semantic",
      coverage: "complete",
      results: [{ practiceId: "platform.semantic" }],
    });
    expect(calls).toHaveLength(2);
    await expect(
      access(contentSemanticIndexPaths(cache, current, profile.profileId).active),
    ).resolves.toBeNull();
    await expect(access(join(root, ".lorelum", "cache"))).rejects.toThrow();
  }));

test("uses the shared N/K candidate boundary for ProjectContext queries", () =>
  fixture(async (root, cache) => {
    await writeProjectCorpus(root, 24);
    const current = await snapshot(root);
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    const embedding = {
      maxBatchSize: 8,
      async embed(inputs: readonly string[]) {
        return { encodingId, vectors: inputs.map(() => [1, 0]) };
      },
    };
    const services = createContentAddressedSemanticServices(current, cache, profile, embedding);
    await services.index.build(services.root);
    const traceService = createContentAddressedSemanticCandidateTraceService(
      current,
      cache,
      profile,
      embedding,
    );

    const trace = await traceService.query(services.root, {
      text: "semantic project index",
      candidateWidth: 20,
      resultLimit: 5,
    });

    expect(trace.candidateIds).toHaveLength(20);
    expect(trace.finalIds).toHaveLength(5);
    expect(trace.finalIds).toEqual(trace.candidateIds.slice(0, 5));
  }));

test("uses the shared task-aware final ordering for ProjectContext queries", () =>
  fixture(async (root, cache) => {
    await writeTaskFixtureProject(root);
    const current = await snapshot(root);
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    const embedding = {
      maxBatchSize: 8,
      async embed(inputs: readonly string[]) {
        return { encodingId, vectors: inputs.map(taskFixtureVector) };
      },
    };
    const services = createContentAddressedSemanticServices(current, cache, profile, embedding);
    await services.index.build(services.root);
    const traceService = createContentAddressedSemanticCandidateTraceService(
      current,
      cache,
      profile,
      embedding,
    );

    const trace = await traceService.query(services.root, {
      text: "Audit rollback",
      candidateWidth: 20,
      resultLimit: 5,
    });

    expect(trace.finalIds[0]).toBe("platform.rollback");
    expect(trace.candidateIds).toEqual(["platform.throughput", "platform.rollback"]);
  }));

test("uses one semantic artifact identity for equivalent directory snapshots", async () => {
  const [first, second, cache] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-project-semantic-first-"),
    createIsolatedProjectSandbox("lorelum-project-semantic-second-"),
    mkdtemp(join(tmpdir(), "lorelum-project-semantic-cache-")),
  ]);
  try {
    await Promise.all([writeProject(first), writeProject(second)]);
    const [left, right] = await Promise.all([snapshot(first), snapshot(second)]);
    const profile = createEmbeddingProfile({ encodingId, dimensions: 2 });
    expect(contentSemanticArtifactId(left, profile.profileId)).toBe(
      contentSemanticArtifactId(right, profile.profileId),
    );
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});
