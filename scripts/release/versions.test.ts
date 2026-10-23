import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  applyEdits,
  checkVersions,
  parseArguments,
  planVersionChange,
  runVersionCommand,
  type Artifact,
  type FileEdit,
  type ReadFile,
  type WriteFile,
} from "./versions.js";

const current = "0.1.0-alpha.6";
const publicPath = "apps/site/content/public-release.json";
const manifests: Readonly<Record<Artifact, string>> = {
  cli: "packages/cli/package.json",
  codex: "plugins/codex/lorelum/.codex-plugin/plugin.json",
  zcode: "plugins/zcode/lorelum/.zcode-plugin/plugin.json",
  cursor: "plugins/cursor/lorelum/.cursor-plugin/plugin.json",
  workbuddy: "plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json",
  claude: "plugins/claude/lorelum/.claude-plugin/plugin.json",
  omp: "plugins/omp/lorelum/package.json",
};
const marketplaces: Partial<Readonly<Record<Artifact, string>>> = {
  zcode: "marketplace.json",
  cursor: ".cursor-plugin/marketplace.json",
  workbuddy: ".codebuddy-plugin/marketplace.json",
  claude: ".claude-plugin/marketplace.json",
  omp: ".omp-plugin/marketplace.json",
};
const sources: Partial<Readonly<Record<Artifact, string>>> = {
  zcode: "./plugins/zcode/lorelum",
  cursor: "./plugins/cursor/lorelum",
  workbuddy: "./plugins/workbuddy/lorelum",
  claude: "./plugins/claude/lorelum",
  omp: "./plugins/omp/lorelum",
};

type Fixture = Readonly<{
  root: string;
  paths: readonly string[];
  read: ReadFile;
  write: WriteFile;
  get: (path: string) => string;
  set: (path: string, content: string) => void;
}>;

function fixture(): Fixture {
  const root = resolve("/virtual/lorelum-release-versions");
  const files = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const artifact of Object.keys(manifests) as Artifact[]) {
    const name = artifact === "cli" ? "@lorelum/cli" : "lorelum";
    contents.set(
      manifests[artifact],
      `${JSON.stringify({ name, version: current, retained: { version: "9.9.9" } }, null, 2)}\n`,
    );
    const marketplace = marketplaces[artifact];
    const source = sources[artifact];
    if (marketplace !== undefined && source !== undefined) {
      contents.set(
        marketplace,
        `${JSON.stringify(
          {
            name: "lorelum-plugins",
            plugins: [
              { name: "lorelum", source, version: current, retained: { version: "8.8.8" } },
              { name: "other", source: "./other", version: "7.0.0" },
            ],
          },
          null,
          2,
        )}\n`,
      );
    }
  }
  contents.set(
    "bun.lock",
    [
      "{",
      '  "lockfileVersion": 1,',
      '  "workspaces": {',
      '    "packages/cli": {',
      '      "name": "@lorelum/cli",',
      `      "version": "${current}",`,
      '      "dependencies": { "keep": "workspace:*" },',
      "    },",
      '    "packages/engine": { "version": "0.0.0" },',
      "  },",
      '  "packages": {},',
      "}",
      "",
    ].join("\n"),
  );
  contents.set(publicPath, `${JSON.stringify({ cli: "0.1.0-alpha.5" }, null, 2)}\n`);
  for (const [path, content] of contents) files.set(resolve(root, path), content);

  const get = (path: string): string => {
    const content = files.get(resolve(root, path));
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
  const set = (path: string, content: string): void => {
    files.set(resolve(root, path), content);
  };
  const read: ReadFile = async (path) => {
    const content = files.get(resolve(path));
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
  const write: WriteFile = async (path, content) => set(path, content);
  return { root, paths: [...contents.keys()], read, write, get, set };
}

function snapshot(testFiles: Fixture): Map<string, string> {
  return new Map(testFiles.paths.map((path) => [path, testFiles.get(path)]));
}

function sortedPaths(edits: readonly FileEdit[]): string[] {
  return edits.map((edit) => edit.path).sort();
}

function execute(testFiles: Fixture, args: readonly string[]) {
  return runVersionCommand(args, testFiles.root, testFiles.write, testFiles.read);
}

describe("release version arguments", () => {
  test("rejects missing, unknown, repeated, and invalid options before writes", async () => {
    const testFiles = fixture();
    let writes = 0;
    const requests: string[][] = [
      ["prepare"],
      ["prepare", "--cli", "not-semver"],
      ["prepare", "--future", "0.1.0"],
      ["prepare", "--cli", "0.1.0", "--cli", "0.2.0"],
    ];
    const results = await Promise.all(
      requests.map((args) =>
        runVersionCommand(
          args,
          testFiles.root,
          async () => {
            writes += 1;
          },
          testFiles.read,
        ),
      ),
    );
    expect(results.every((result) => result.exitCode === 1)).toBe(true);
    expect(writes).toBe(0);
    expect(() => parseArguments(["prepare", "--cli", "v0.1.0"])).toThrow("不带 v");
    expect(() => parseArguments(["docs"])).toThrow("必须指定 --cli");
    expect(() => parseArguments(["docs", "--zcode", "0.1.0"])).toThrow("不支持参数");
    expect(() => parseArguments(["check", "--dry-run"])).toThrow("不接受参数");
  });
});

describe("release version planning", () => {
  test("updates only the CLI manifest and its JSONC lockfile entry", async () => {
    const testFiles = fixture();
    const before = snapshot(testFiles);
    const { edits } = await planVersionChange(
      testFiles.root,
      { action: "prepare", targets: new Map([["cli", "0.1.0-alpha.7"]]) },
      testFiles.read,
    );
    expect(sortedPaths(edits)).toEqual(
      [resolve(testFiles.root, manifests.cli), resolve(testFiles.root, "bun.lock")].sort(),
    );
    const manifestEdit = edits.find((edit) => edit.path.endsWith(manifests.cli))!;
    expect(manifestEdit.after).toBe(
      manifestEdit.before.replace(`  "version": "${current}",`, '  "version": "0.1.0-alpha.7",'),
    );
    const lockEdit = edits.find((edit) => edit.path.endsWith("bun.lock"))!;
    expect(lockEdit.after).toBe(
      lockEdit.before.replace(
        `      "version": "${current}",`,
        '      "version": "0.1.0-alpha.7",',
      ),
    );

    const preview = await runVersionCommand(
      ["prepare", "--cli", "0.1.0-alpha.7", "--dry-run"],
      testFiles.root,
      async () => {
        throw new Error("dry-run must not write");
      },
      testFiles.read,
    );
    expect(preview.exitCode).toBe(0);
    expect(preview.output).toContain("cli: 0.1.0-alpha.6 → 0.1.0-alpha.7");
    expect(snapshot(testFiles)).toEqual(before);

    await applyEdits(edits, testFiles.write, testFiles.read);
    const prepared = snapshot(testFiles);
    const repeat = await execute(testFiles, ["prepare", "--cli", "0.1.0-alpha.7"]);
    expect(repeat.exitCode).toBe(0);
    expect(repeat.output).toContain("无改动。");
    expect(snapshot(testFiles)).toEqual(prepared);
  });

  test("keeps escaped version bytes when the requested value is already present", async () => {
    const testFiles = fixture();
    const escapedCurrent = "0.1.0-alpha.\\u0036";
    const manifest = testFiles
      .get(manifests.cli)
      .replace(`"version": "${current}"`, `"version": "${escapedCurrent}"`);
    testFiles.set(manifests.cli, manifest);

    const prepare = await execute(testFiles, ["prepare", "--cli", current]);
    expect(prepare.exitCode).toBe(0);
    expect(prepare.output).toContain("无改动。");
    expect(testFiles.get(manifests.cli)).toBe(manifest);
    expect(testFiles.get(manifests.cli)).toContain('"version": "0.1.0-alpha.\\u0036"');

    const escapedPublic = testFiles.get(publicPath).replace("0.1.0-alpha.5", "0.1.0-alpha.\\u0035");
    testFiles.set(publicPath, escapedPublic);
    const docs = await execute(testFiles, ["docs", "--cli", "0.1.0-alpha.5"]);
    expect(docs.exitCode).toBe(0);
    expect(docs.output).toContain("无改动。");
    expect(testFiles.get(publicPath)).toBe(escapedPublic);
  });

  test("preserves manifest and lockfile trivia between keys and colons", async () => {
    const testFiles = fixture();
    testFiles.set(
      manifests.cli,
      testFiles.get(manifests.cli).replace('"version":', '"version"  :'),
    );
    testFiles.set(
      "bun.lock",
      testFiles.get("bun.lock").replace('      "version":', '      "version" /* key comment */ :'),
    );

    const plan = await planVersionChange(
      testFiles.root,
      { action: "prepare", targets: new Map([["cli", "0.1.0-alpha.7"]]) },
      testFiles.read,
    );
    const manifestAfter = plan.edits.find((edit) => edit.path.endsWith(manifests.cli))!.after;
    const lockAfter = plan.edits.find((edit) => edit.path.endsWith("bun.lock"))!.after;

    expect(JSON.parse(manifestAfter).version).toBe("0.1.0-alpha.7");
    expect(manifestAfter).toContain('"version"  : "0.1.0-alpha.7"');
    expect(
      (Bun.JSONC.parse(lockAfter) as { workspaces: { "packages/cli": { version: string } } })
        .workspaces["packages/cli"].version,
    ).toBe("0.1.0-alpha.7");
    expect(lockAfter).toContain('"version" /* key comment */ : "0.1.0-alpha.7"');
  });

  test("preserves whitespace between the public recommendation key and colon", async () => {
    const testFiles = fixture();
    testFiles.set(publicPath, testFiles.get(publicPath).replace('"cli":', '"cli"  :'));

    const plan = await planVersionChange(
      testFiles.root,
      { action: "docs", cli: "0.1.0-alpha.4" },
      testFiles.read,
    );
    const after = plan.edits[0]!.after;

    expect(JSON.parse(after).cli).toBe("0.1.0-alpha.4");
    expect(after).toContain('"cli"  : "0.1.0-alpha.4"');
  });

  test("recognizes lone CR as a JSONC line-comment terminator", async () => {
    const testFiles = fixture();
    const lock = testFiles
      .get("bun.lock")
      .replace(/\n/g, "\r")
      .replace('    "packages/cli": {', '    "packages/cli": {\r      // ignored delimiters } ]\r');
    testFiles.set("bun.lock", lock);

    const plan = await planVersionChange(
      testFiles.root,
      { action: "prepare", targets: new Map([["cli", "0.1.0-alpha.7"]]) },
      testFiles.read,
    );
    const lockAfter = plan.edits.find((edit) => edit.path.endsWith("bun.lock"))!.after;
    expect(
      (Bun.JSONC.parse(lockAfter) as { workspaces: { "packages/cli": { version: string } } })
        .workspaces["packages/cli"].version,
    ).toBe("0.1.0-alpha.7");
  });

  test("locates the CLI workspace by structure across JSONC comments and strings", async () => {
    const testFiles = fixture();
    const lock = testFiles
      .get("bun.lock")
      .replace(
        '  "lockfileVersion": 1,',
        '  "lockfileVersion": 1,\n  "metadata": { "packages/cli": { "version": "8.8.8" } },',
      )
      .replace(
        '    "packages/cli": {',
        [
          '    "packages/cli": {',
          '      // "packages/cli": { "version": "9.9.9" } } ]',
          '      /* "version": "7.7.7" } ] { */',
          `      "note": ${JSON.stringify('escaped " quote with } ]')},`,
        ].join("\n"),
      );
    testFiles.set("bun.lock", lock);

    const { edits } = await planVersionChange(
      testFiles.root,
      { action: "prepare", targets: new Map([["cli", "0.1.0-alpha.7"]]) },
      testFiles.read,
    );
    const lockAfter = edits.find((edit) => edit.path.endsWith("bun.lock"))!.after;
    const parsed = Bun.JSONC.parse(lockAfter) as {
      metadata: { "packages/cli": { version: string } };
      workspaces: { "packages/cli": { version: string } };
    };

    expect(parsed.metadata["packages/cli"].version).toBe("8.8.8");
    expect(parsed.workspaces["packages/cli"].version).toBe("0.1.0-alpha.7");
    expect(lockAfter).toContain('// "packages/cli": { "version": "9.9.9" } } ]');
    expect(lockAfter).toContain('"note": "escaped \\" quote with } ]"');
  });

  test("rejects repeated structural version anchors without writing", async () => {
    const testFiles = fixture();
    const lock = testFiles
      .get("bun.lock")
      .replace(
        '    "packages/engine":',
        `    "packages/cli": { "version": "${current}" },\n    "packages/engine":`,
      );
    testFiles.set("bun.lock", lock);
    let writes = 0;

    const result = await runVersionCommand(
      ["prepare", "--cli", "0.1.0-alpha.7"],
      testFiles.root,
      async () => {
        writes += 1;
      },
      testFiles.read,
    );

    expect(result.exitCode).toBe(1);
    expect(writes).toBe(0);
    expect(testFiles.get("bun.lock")).toBe(lock);
  });

  test("updates each host's own native manifest and marketplace entry only", async () => {
    const hosts: Artifact[] = ["codex", "zcode", "cursor", "workbuddy", "claude", "omp"];
    await Promise.all(
      hosts.map(async (artifact) => {
        const testFiles = fixture();
        const before = snapshot(testFiles);
        const { edits } = await planVersionChange(
          testFiles.root,
          { action: "prepare", targets: new Map([[artifact, "0.2.0"]]) },
          testFiles.read,
        );
        const expected = [manifests[artifact], marketplaces[artifact]]
          .filter((path): path is string => path !== undefined)
          .map((path) => resolve(testFiles.root, path))
          .sort();
        expect(sortedPaths(edits)).toEqual(expected);
        await applyEdits(edits, testFiles.write, testFiles.read);
        for (const path of testFiles.paths) {
          if (expected.includes(resolve(testFiles.root, path))) continue;
          expect(testFiles.get(path)).toBe(before.get(path)!);
        }
        if (artifact === "codex") expect(edits).toHaveLength(1);
      }),
    );
  });

  test("supports different CLI and Codex targets without a Codex marketplace mirror", async () => {
    const testFiles = fixture();
    const before = snapshot(testFiles);
    const { edits } = await planVersionChange(
      testFiles.root,
      {
        action: "prepare",
        targets: new Map([
          ["cli", "0.1.0-alpha.7"],
          ["codex", "0.1.0-alpha.8"],
        ]),
      },
      testFiles.read,
    );
    expect(sortedPaths(edits)).toEqual(
      [
        resolve(testFiles.root, manifests.cli),
        resolve(testFiles.root, "bun.lock"),
        resolve(testFiles.root, manifests.codex),
      ].sort(),
    );
    expect(testFiles.get(publicPath)).toBe(before.get(publicPath)!);
    expect(edits.some((edit) => edit.path.includes("marketplace.json"))).toBe(false);
  });

  test("rejects inconsistent or missing selected mirrors but does not inspect unselected issues", async () => {
    const testFiles = fixture();
    const marketPath = marketplaces.zcode!;
    const mismatched = testFiles.get(marketPath).replace(current, "0.1.0-alpha.4");
    testFiles.set(marketPath, mismatched);
    let writes = 0;
    const mismatch = await runVersionCommand(
      ["prepare", "--zcode", "0.2.0"],
      testFiles.root,
      async () => {
        writes += 1;
      },
      testFiles.read,
    );
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.errors.join("\n")).toContain("实际 0.1.0-alpha.4");
    expect(writes).toBe(0);

    const renamed = mismatched.replace('"./plugins/zcode/lorelum"', '"./plugins/zcode/renamed"');
    testFiles.set(marketPath, renamed);
    const missing = await runVersionCommand(
      ["prepare", "--zcode", "0.2.0"],
      testFiles.root,
      async () => {
        writes += 1;
      },
      testFiles.read,
    );
    expect(missing.exitCode).toBe(1);
    expect(missing.errors.join("\n")).toContain("找到 0 个");
    expect(writes).toBe(0);

    const cli = await execute(testFiles, ["prepare", "--cli", "0.1.0-alpha.7"]);
    expect(cli.exitCode).toBe(0);
    expect(testFiles.get(marketPath)).toBe(renamed);
    const check = await execute(testFiles, ["check"]);
    expect(check.exitCode).toBe(1);
  });

  test("docs changes only the single public recommendation and check permits it to lag", async () => {
    const testFiles = fixture();
    expect(await checkVersions(testFiles.root, testFiles.read)).toEqual([]);
    const before = snapshot(testFiles);
    const preview = await runVersionCommand(
      ["docs", "--cli", "0.1.0-alpha.4", "--dry-run"],
      testFiles.root,
      async () => {
        throw new Error("dry-run must not write");
      },
      testFiles.read,
    );
    expect(preview.exitCode).toBe(0);
    expect(preview.output[0]).toContain("未写入");
    expect(snapshot(testFiles)).toEqual(before);

    const result = await execute(testFiles, ["docs", "--cli", "0.1.0-alpha.4"]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("公开 CLI 推荐: 0.1.0-alpha.5 → 0.1.0-alpha.4");
    for (const path of testFiles.paths) {
      if (path === publicPath) continue;
      expect(testFiles.get(path)).toBe(before.get(path)!);
    }
    expect(await checkVersions(testFiles.root, testFiles.read)).toEqual([]);
    const after = snapshot(testFiles);
    const repeat = await execute(testFiles, ["docs", "--cli", "0.1.0-alpha.4"]);
    expect(repeat.output).toContain("无改动。");
    expect(snapshot(testFiles)).toEqual(after);

    for (const malformed of ['{ "cli": "latest" }\n', "{}\n"]) {
      testFiles.set(publicPath, malformed);
      let writes = 0;
      // Each request uses the same fixture, so verify it before replacing the next input.
      // eslint-disable-next-line no-await-in-loop
      const bad = await runVersionCommand(
        ["docs", "--cli", "0.2.0"],
        testFiles.root,
        async () => {
          writes += 1;
        },
        testFiles.read,
      );
      expect(bad.exitCode).toBe(1);
      expect(bad.errors.join("\n")).toContain("public-release.json");
      expect(writes).toBe(0);
      expect(testFiles.get(publicPath)).toBe(malformed);
    }
  });
});

describe("release version write recovery", () => {
  test("prechecks all content and restores the partially written failure file", async () => {
    const testFiles = fixture();
    const { edits } = await planVersionChange(
      testFiles.root,
      { action: "prepare", targets: new Map([["cli", "0.1.0-alpha.7"]]) },
      testFiles.read,
    );
    const before = new Map(edits.map((edit) => [edit.path, edit.before]));
    const changed = edits[0]!;
    testFiles.set(changed.path, `${changed.before} `);
    let writes = 0;
    await expect(
      applyEdits(
        edits,
        async () => {
          writes += 1;
        },
        testFiles.read,
      ),
    ).rejects.toThrow("预检后发生变化");
    expect(writes).toBe(0);
    expect(testFiles.get(edits[1]!.path)).toBe(before.get(edits[1]!.path)!);

    testFiles.set(changed.path, changed.before);
    const failedPath = edits[1]!.path;
    let failedOnce = false;
    const partialWriter: WriteFile = async (path, content) => {
      if (path === failedPath && !failedOnce) {
        failedOnce = true;
        testFiles.set(path, content.slice(0, 12));
        throw new Error("simulated partial write");
      }
      testFiles.set(path, content);
    };
    await expect(applyEdits(edits, partialWriter, testFiles.read)).rejects.toThrow(
      "已尝试恢复 2 个文件",
    );
    for (const edit of edits) expect(testFiles.get(edit.path)).toBe(before.get(edit.path)!);
  });

  test("names a path if recovery fails", async () => {
    const testFiles = fixture();
    const { edits } = await planVersionChange(
      testFiles.root,
      { action: "prepare", targets: new Map([["cli", "0.1.0-alpha.7"]]) },
      testFiles.read,
    );
    const failedPath = edits[1]!.path;
    const failingWriter: WriteFile = async (path, content) => {
      if (path === failedPath) {
        testFiles.set(path, content.slice(0, 12));
        throw new Error("recovery denied");
      }
      testFiles.set(path, content);
    };
    await expect(applyEdits(edits, failingWriter, testFiles.read)).rejects.toThrow(
      `恢复失败：${failedPath}: recovery denied`,
    );
  });
});
