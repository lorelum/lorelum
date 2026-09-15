import { expect, test } from "bun:test";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { projectKeywordArtifactId, projectKeywordIndexPaths } from "./cache";
import { queryProjectContextKeyword } from "./keyword-query";
import { resolveProjectContext } from "./resolver";

async function project(root: string, title: string): Promise<void> {
  const pack = join(root, ".lorelum", "packs", "platform");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
  await writeFile(
    join(pack, "practices", "query.md"),
    `---\nid: platform.query\ntitle: ${title}\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When designing a safe query cache.\n---\nUse content-addressed artifacts outside the project directory.\n`,
  );
}

async function resolve(root: string) {
  const snapshot = await resolveProjectContext({
    startDirectory: root,
    storageRoot: { rootPath: join(root, "store") },
    store: {
      async readEffectivePracticeSnapshot() {
        return { practices: [] };
      },
    },
  });
  if (snapshot === undefined) throw new Error("Expected ProjectContext");
  return snapshot;
}

test("queries a content-addressed keyword artifact outside the project source tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-project-keyword-"));
  const cache = await mkdtemp(join(tmpdir(), "lorelum-project-cache-"));
  try {
    await project(root, "Content addressed query cache");
    const snapshot = await resolve(root);
    const result = await queryProjectContextKeyword(snapshot, cache, {
      text: "content addressed cache",
    });
    expect(result.results.map((hit) => hit.practiceId)).toEqual(["platform.query"]);
    const paths = projectKeywordIndexPaths(cache, snapshot);
    await expect(access(paths.active)).resolves.toBeNull();
    await expect(access(join(root, ".lorelum", "cache"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test("equivalent directories converge on the same immutable keyword artifact", async () => {
  const first = await mkdtemp(join(tmpdir(), "lorelum-project-keyword-first-"));
  const second = await mkdtemp(join(tmpdir(), "lorelum-project-keyword-second-"));
  const cache = await mkdtemp(join(tmpdir(), "lorelum-project-cache-"));
  try {
    await Promise.all([
      project(first, "Content addressed query cache"),
      project(second, "Content addressed query cache"),
    ]);
    const [left, right] = await Promise.all([resolve(first), resolve(second)]);
    expect(projectKeywordArtifactId(left)).toBe(projectKeywordArtifactId(right));
    await queryProjectContextKeyword(left, cache, { text: "cache" });
    const paths = projectKeywordIndexPaths(cache, right);
    await expect(access(paths.active)).resolves.toBeNull();
    const result = await queryProjectContextKeyword(right, cache, { text: "cache" });
    expect(result.results).toHaveLength(1);
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("corrupt ProjectContext keyword artifacts are discarded and rebuilt from canonical source", async () => {
  const root = await mkdtemp(join(tmpdir(), "lorelum-project-keyword-corrupt-"));
  const cache = await mkdtemp(join(tmpdir(), "lorelum-project-cache-corrupt-"));
  try {
    await project(root, "Recoverable keyword artifact");
    const snapshot = await resolve(root);
    const paths = projectKeywordIndexPaths(cache, snapshot);
    await queryProjectContextKeyword(snapshot, cache, { text: "recoverable" });
    await writeFile(paths.active, "not a sqlite database");

    await expect(
      queryProjectContextKeyword(snapshot, cache, { text: "recoverable" }),
    ).resolves.toMatchObject({
      results: [{ practiceId: "platform.query" }],
    });
    await expect(access(paths.active)).resolves.toBeNull();
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});
