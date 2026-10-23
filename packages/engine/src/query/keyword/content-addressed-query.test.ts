import { expect, test } from "bun:test";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentKeywordArtifactId, contentKeywordIndexPaths } from "../artifacts/cache";
import { queryContentAddressedKeyword } from "./content-addressed-query";
import { createIsolatedProjectSandbox } from "../../project-context/project-sandbox.test-helper";
import { resolveProjectContext } from "../../project-context/resolver";

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
  const root = await createIsolatedProjectSandbox("lorelum-project-keyword-");
  const cache = await mkdtemp(join(tmpdir(), "lorelum-project-cache-"));
  try {
    await project(root, "Content addressed query cache");
    const snapshot = await resolve(root);
    const result = await queryContentAddressedKeyword(snapshot, cache, {
      text: "content addressed cache",
    });
    expect(result.results.map((hit) => hit.practiceId)).toEqual(["platform.query"]);
    await expect(
      queryContentAddressedKeyword(snapshot, cache, { text: "zzznomatch" }),
    ).resolves.toEqual({ mode: "keyword", results: [] });
    const paths = contentKeywordIndexPaths(cache, snapshot);
    await expect(access(paths.active)).resolves.toBeNull();
    await expect(access(join(root, ".lorelum", "cache"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test("reports a proven empty ProjectContext corpus on cold and warm keyword queries", async () => {
  const root = await createIsolatedProjectSandbox("lorelum-project-keyword-empty-");
  const cache = await mkdtemp(join(tmpdir(), "lorelum-project-cache-empty-"));
  try {
    await mkdir(join(root, ".lorelum"), { recursive: true });
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    const snapshot = await resolve(root);
    expect(snapshot.practices).toHaveLength(0);

    for (const text of ["first query", "warm query"]) {
      // eslint-disable-next-line no-await-in-loop -- verify the complete corpus remains available on both cache states.
      await expect(queryContentAddressedKeyword(snapshot, cache, { text })).resolves.toEqual({
        mode: "keyword",
        results: [],
        emptyReason: "corpus-empty",
      });
    }
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cache, { recursive: true, force: true }),
    ]);
  }
});

test("equivalent directories converge on the same immutable keyword artifact", async () => {
  const first = await createIsolatedProjectSandbox("lorelum-project-keyword-first-");
  const second = await createIsolatedProjectSandbox("lorelum-project-keyword-second-");
  const cache = await mkdtemp(join(tmpdir(), "lorelum-project-cache-"));
  try {
    await Promise.all([
      project(first, "Content addressed query cache"),
      project(second, "Content addressed query cache"),
    ]);
    const [left, right] = await Promise.all([resolve(first), resolve(second)]);
    expect(contentKeywordArtifactId(left)).toBe(contentKeywordArtifactId(right));
    await queryContentAddressedKeyword(left, cache, { text: "cache" });
    const paths = contentKeywordIndexPaths(cache, right);
    await expect(access(paths.active)).resolves.toBeNull();
    const result = await queryContentAddressedKeyword(right, cache, { text: "cache" });
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
  const root = await createIsolatedProjectSandbox("lorelum-project-keyword-corrupt-");
  const cache = await mkdtemp(join(tmpdir(), "lorelum-project-cache-corrupt-"));
  try {
    await project(root, "Recoverable keyword artifact");
    const snapshot = await resolve(root);
    const paths = contentKeywordIndexPaths(cache, snapshot);
    await queryContentAddressedKeyword(snapshot, cache, { text: "recoverable" });
    await writeFile(paths.active, "not a sqlite database");

    await expect(
      queryContentAddressedKeyword(snapshot, cache, { text: "recoverable" }),
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
