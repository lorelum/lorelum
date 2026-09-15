import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalizePractice } from "../local-store/model/canonical-practice";
import type { EffectivePractice } from "../local-store/model/types";
import { InvalidProjectRootError } from "./types";
import { resolveProjectContext } from "./resolver";

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lorelum-project-context-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function practice(id: string, title: string, body = "Keep it focused."): string {
  return `---\nid: ${id}\ntitle: ${title}\nstage: implementation\ntech_stack:\n  - typescript\napplies_when: When this Practice applies.\n---\n${body}\n`;
}

async function writePack(
  root: string,
  directory: string,
  name: string,
  practices: Readonly<Record<string, string>>,
): Promise<void> {
  const packRoot = join(root, ".lorelum", "packs", directory);
  await mkdir(join(packRoot, "practices"), { recursive: true });
  await writeFile(join(packRoot, "pack.yaml"), `name: ${name}\nversion: 1.0.0\n`);
  await Promise.all(
    Object.entries(practices).map(([file, content]) =>
      writeFile(join(packRoot, "practices", `${file}.md`), content),
    ),
  );
}

function storePractice(id: string, title: string): EffectivePractice {
  const canonicalPractice = canonicalizePractice({
    id,
    title,
    stage: "implementation",
    tech_stack: ["typescript"],
    applies_when: "When this Store Practice applies.",
    body: "Store guidance.",
  });
  const source = Object.freeze({
    packName: "store-pack",
    practiceId: id,
    contentDigest: canonicalPractice.contentDigest,
    sourcePath: `practices/${id}.md`,
    canonicalPractice,
  });
  return Object.freeze({
    practiceId: id,
    contentDigest: canonicalPractice.contentDigest,
    canonicalContent: canonicalPractice.canonicalContent,
    practice: canonicalPractice.practice,
    sources: Object.freeze([source]),
  });
}

function resolverOptions(root: string, practices: readonly EffectivePractice[] = []) {
  return {
    startDirectory: root,
    storageRoot: { rootPath: join(root, "store") },
    store: {
      async readEffectivePracticeSnapshot() {
        return { practices };
      },
    },
  } as const;
}

test("inherits parent layers and replaces only matching Practice ids", () =>
  fixture(async (root) => {
    const child = join(root, "apps", "web");
    await mkdir(child, { recursive: true });
    await mkdir(join(root, ".lorelum"));
    await writeFile(
      join(root, ".lorelum", "config.yaml"),
      "base: none\npacks:\n  platform:\n    priority: 10\n",
    );
    await writePack(root, "platform", "platform", {
      shared: practice("platform.shared", "Parent shared", "Parent guidance."),
      parent: practice("platform.parent", "Parent only"),
    });
    await mkdir(join(child, ".lorelum"));
    await writeFile(
      join(child, ".lorelum", "config.yaml"),
      "packs:\n  platform:\n    priority: 100\n  payments:\n    enabled: true\n",
    );
    await writePack(child, "platform", "platform", {
      shared: practice("platform.shared", "Child shared", "Child guidance."),
    });

    const snapshot = await resolveProjectContext({
      ...resolverOptions(child),
      startDirectory: child,
    });
    expect(snapshot?.effectiveConfig).toEqual({
      base: "none",
      packs: {
        platform: { enabled: true, priority: 100 },
        payments: { enabled: true, priority: 0 },
      },
    });
    expect(snapshot?.practices.map((item) => [item.practiceId, item.practice.title])).toEqual([
      ["platform.parent", "Parent only"],
      ["platform.shared", "Child shared"],
    ]);
    expect(
      snapshot?.sources.some(
        (source) => source.status === "shadowed" && source.practiceId === "platform.shared",
      ),
    ).toBe(true);
  }));

test("inherit false isolates a child layer while retaining its own Pack", () =>
  fixture(async (root) => {
    const child = join(root, "nested");
    await mkdir(child, { recursive: true });
    await mkdir(join(root, ".lorelum"));
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    await writePack(root, "parent", "parent", { parent: practice("parent.only", "Parent") });
    await mkdir(join(child, ".lorelum"));
    await writeFile(join(child, ".lorelum", "config.yaml"), "inherit: false\nbase: none\n");
    await writePack(child, "child", "child", { child: practice("child.only", "Child") });

    const snapshot = await resolveProjectContext({
      ...resolverOptions(child),
      startDirectory: child,
    });
    expect(snapshot?.practices.map((item) => item.practiceId)).toEqual(["child.only"]);
    expect(snapshot?.layers).toEqual([{ depth: 1 }]);
  }));

test("keeps valid Pack neighbors and Store fallback when one local Practice is malformed", () =>
  fixture(async (root) => {
    await mkdir(join(root, ".lorelum"));
    await writePack(root, "platform", "platform", {
      valid: practice("platform.valid", "Valid local"),
      broken: "---\nid: platform.fallback\nstage: missing-title\n---\nbroken\n",
    });
    const snapshot = await resolveProjectContext(
      resolverOptions(root, [storePractice("platform.fallback", "Store fallback")]),
    );
    expect(snapshot?.state).toBe("degraded");
    expect(snapshot?.practices.map((item) => [item.practiceId, item.practice.title])).toEqual([
      ["platform.fallback", "Store fallback"],
      ["platform.valid", "Valid local"],
    ]);
    expect(snapshot?.warnings).toContainEqual({
      code: "practice.invalid",
      layerDepth: 0,
      packName: "platform",
      practiceId: "platform.fallback",
    });
  }));

test("ignores an invalid Pack while retaining valid sibling Packs", () =>
  fixture(async (root) => {
    await mkdir(join(root, ".lorelum", "packs", "broken"), { recursive: true });
    await writeFile(join(root, ".lorelum", "packs", "broken", "pack.yaml"), "name: nope\n");
    await writePack(root, "safe", "safe", { valid: practice("safe.valid", "Safe") });

    const snapshot = await resolveProjectContext(resolverOptions(root));
    expect(snapshot?.state).toBe("degraded");
    expect(snapshot?.practices.map((item) => item.practiceId)).toEqual(["safe.valid"]);
    expect(snapshot?.warnings).toContainEqual({ code: "pack.invalid", layerDepth: 0 });
  }));

test("uses parent configuration after a child config becomes invalid", () =>
  fixture(async (root) => {
    const child = join(root, "child");
    await mkdir(child, { recursive: true });
    await mkdir(join(root, ".lorelum"));
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    await mkdir(join(child, ".lorelum"));
    await writeFile(join(child, ".lorelum", "config.yaml"), "packs: nope\n");
    await writePack(child, "child", "child", { local: practice("child.local", "Local") });

    const snapshot = await resolveProjectContext({
      ...resolverOptions(child),
      startDirectory: child,
    });
    expect(snapshot?.effectiveConfig.base).toBe("none");
    expect(snapshot?.practices.map((item) => item.practiceId)).toEqual(["child.local"]);
    expect(snapshot?.warnings).toContainEqual({ code: "config.invalid", layerDepth: 1 });
  }));

test.skipIf(process.platform === "win32")(
  "ignores an unsafe Pack symlink without hiding safe Pack neighbors",
  () =>
    fixture(async (root) => {
      await mkdir(join(root, ".lorelum"));
      await writePack(root, "safe", "safe", { valid: practice("safe.valid", "Safe") });
      const external = await mkdtemp(join(tmpdir(), "lorelum-project-external-pack-"));
      try {
        await symlink(external, join(root, ".lorelum", "packs", "escaped"));
        const snapshot = await resolveProjectContext(resolverOptions(root));
        expect(snapshot?.state).toBe("degraded");
        expect(snapshot?.practices.map((item) => item.practiceId)).toEqual(["safe.valid"]);
        expect(snapshot?.warnings).toContainEqual({ code: "source.unsafe", layerDepth: 0 });
      } finally {
        await rm(external, { recursive: true, force: true });
      }
    }),
);

test("rejects an explicit root that does not directly contain .lorelum", () =>
  fixture(async (root) => {
    await expect(
      resolveProjectContext({ ...resolverOptions(root), projectRoot: join(root, "missing") }),
    ).rejects.toBeInstanceOf(InvalidProjectRootError);
  }));
