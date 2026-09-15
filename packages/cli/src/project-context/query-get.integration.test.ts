import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, createQueryService, decodePackDirectory } from "@lorelum/engine";

import { createGetCommand } from "../get/get-command";
import { run } from "../main";
import { validateJsonSchema } from "../output/protocol-schema.test-helper";
import { createProjectContextResolver } from "../project-context/service";
import { createQueryCommand } from "../query/query-command";
import { snapshotCommandDefinitions } from "../registry";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

async function writePractice(
  pack: string,
  file: string,
  id: string,
  title: string,
  body: string,
): Promise<void> {
  await writeFile(
    join(pack, "practices", file),
    `---
id: ${id}
title: ${title}
stage: implementation
tech_stack:
  - typescript
applies_when: When testing ProjectContext command routing.
---
${body}
`,
  );
}

async function writePack(
  root: string,
  name: string,
  practices: readonly {
    readonly file: string;
    readonly id: string;
    readonly title: string;
    readonly body: string;
  }[],
): Promise<string> {
  const pack = join(root, ".lorelum", "packs", name);
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), `name: ${name}\nversion: 1.0.0\n`);
  await Promise.all(
    practices.map((practice) =>
      writePractice(pack, practice.file, practice.id, practice.title, practice.body),
    ),
  );
  return pack;
}

test("query and get use project winners, retain valid neighbors, and keep --no-project Store-only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-project-context-"));
  const storeRoot = join(directory, "store");
  const cacheRoot = join(directory, "cache");
  const parent = join(directory, "parent");
  const child = join(parent, "child");
  try {
    const storePack = join(directory, "store-pack");
    await mkdir(join(storePack, "practices"), { recursive: true });
    await writeFile(join(storePack, "pack.yaml"), "name: stored\nversion: 1.0.0\n");
    await writePractice(
      storePack,
      "shared.md",
      "platform.shared",
      "Store shared",
      "store-only fallback guidance",
    );
    await writePractice(
      storePack,
      "only.md",
      "store.only",
      "Store only",
      "store-only unique guidance",
    );
    const store = createLocalStore();
    const decoded = await decodePackDirectory(storePack);
    await store.install({ rootPath: storeRoot }, decoded.candidate, decoded.diagnostics);

    await writePack(parent, "platform", [
      {
        file: "parent.md",
        id: "platform.parent",
        title: "Parent practice",
        body: "parent inherited guidance",
      },
      {
        file: "shared.md",
        id: "platform.shared",
        title: "Parent shared",
        body: "parent shared guidance",
      },
    ]);
    const childPack = await writePack(child, "platform", [
      {
        file: "shared.md",
        id: "platform.shared",
        title: "Child shared",
        body: "child overlay guidance",
      },
      {
        file: "neighbor.md",
        id: "platform.neighbor",
        title: "Valid neighbor",
        body: "valid neighbor guidance",
      },
    ]);
    await writeFile(
      join(childPack, "practices", "broken.md"),
      "---\nid: platform.broken\nstage: implementation\n---\nInvalid Practice\n",
    );

    let semanticClientCalls = 0;
    const definitions = snapshotCommandDefinitions([
      createQueryCommand({
        queryService: createQueryService({ store }),
        createClient: async () => {
          semanticClientCalls += 1;
          throw new Error("keyword retrieval must not connect to the Backend");
        },
        storageRoot: { rootPath: storeRoot },
        resolveProjectContext: createProjectContextResolver(store),
      }),
      createGetCommand({
        store,
        storageRoot: { rootPath: storeRoot },
        resolveProjectContext: createProjectContextResolver(store),
      }),
    ]);
    const invoke = async (arguments_: readonly string[]) => {
      const stdout = new MemoryWriter();
      const exitCode = await run([...arguments_], { registry: definitions, stdout });
      const response = JSON.parse(stdout.value) as { readonly data?: unknown };
      return { exitCode, response, output: stdout.value };
    };
    const globals = [
      "--store-root",
      storeRoot,
      "--project-root",
      child,
      "--cache-root",
      cacheRoot,
    ] as const;
    const readGlobals = ["--store-root", storeRoot, "--project-root", child] as const;

    const childQuery = await invoke([...globals, "query", "child overlay", "--mode", "keyword"]);
    expect(childQuery.exitCode).toBe(0);
    expect(childQuery.response).toMatchObject({
      ok: true,
      data: {
        mode: "keyword",
        results: [{ practiceId: "platform.shared", title: "Child shared" }],
        context: {
          state: "degraded",
          warnings: [{ code: "practice.invalid", packName: "platform" }],
        },
      },
    });

    const parentQuery = await invoke([
      ...globals,
      "query",
      "parent inherited",
      "--mode",
      "keyword",
    ]);
    expect(parentQuery.exitCode).toBe(0);
    expect(parentQuery.response).toMatchObject({
      data: { results: [{ practiceId: "platform.parent", title: "Parent practice" }] },
    });

    const neighborQuery = await invoke([
      ...globals,
      "query",
      "valid neighbor",
      "--mode",
      "keyword",
    ]);
    expect(neighborQuery.exitCode).toBe(0);
    expect(neighborQuery.response).toMatchObject({
      data: { results: [{ practiceId: "platform.neighbor" }] },
    });

    const localGet = await invoke([...readGlobals, "get", "platform.shared"]);
    expect(localGet.exitCode).toBe(0);
    expect(localGet.response).toMatchObject({
      data: {
        practice: { title: "Child shared", body: "child overlay guidance\n" },
        sources: [{ packRoot: "project-layer-1", sourcePath: "practices/shared.md" }],
      },
    });

    const storeOnlyQuery = await invoke([
      "--store-root",
      storeRoot,
      "--no-project",
      "query",
      "store-only unique",
      "--mode",
      "keyword",
    ]);
    expect(storeOnlyQuery.exitCode).toBe(0);
    expect(storeOnlyQuery.response.data).toMatchObject({ mode: "keyword" });
    expect(
      (storeOnlyQuery.response.data as { readonly results: readonly unknown[] }).results,
    ).toContainEqual(expect.objectContaining({ practiceId: "store.only", title: "Store only" }));
    expect(storeOnlyQuery.response.data).not.toMatchObject({ context: expect.anything() });

    const storeOnlyGet = await invoke([
      "--store-root",
      storeRoot,
      "--no-project",
      "get",
      "platform.shared",
    ]);
    expect(storeOnlyGet.exitCode).toBe(0);
    expect(storeOnlyGet.response).toMatchObject({
      data: { practice: { title: "Store shared", body: "store-only fallback guidance\n" } },
    });
    expect(semanticClientCalls).toBe(0);
    expect(childQuery.output).not.toContain(child);
    expect(validateJsonSchema(childQuery.response.data, definitions[0]!.resultSchema)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
