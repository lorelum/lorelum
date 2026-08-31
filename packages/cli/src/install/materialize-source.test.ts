import { expect, test } from "bun:test";
import { defaultPackDirectoryLimits } from "@lorelum/engine";
import type { RegistryRelease } from "@lorelum/format";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { materializeRegistryRelease, type MaterializeGitRunner } from "./materialize-source.js";

const release: RegistryRelease = {
  version: "0.2.0",
  ref: "agentic-coding-v0.2.0",
  path: "packs/agentic-coding",
};
const repository = "https://github.com/lorelum/lorelum-packs.git";
const resolvedCommit = "f".repeat(40);

interface TreeEntry {
  readonly contents: Uint8Array;
  readonly mode: string;
  readonly objectId: string;
  readonly path: string;
  readonly type: "blob" | "commit" | "tree";
}

interface GitCall {
  readonly args: readonly string[];
  readonly input?: Uint8Array;
  readonly outputLimit?: number;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function objectId(index: number): string {
  return index.toString(16).padStart(40, "0");
}

function entry(
  relativePath: string,
  contents: string | Uint8Array,
  index: number,
  options: Partial<Pick<TreeEntry, "mode" | "type">> = {},
): TreeEntry {
  return {
    contents: typeof contents === "string" ? bytes(contents) : contents,
    mode: options.mode ?? "100644",
    objectId: objectId(index),
    path: `${release.path}/${relativePath}`,
    type: options.type ?? "blob",
  };
}

function packEntries(practiceCount = 29): TreeEntry[] {
  const entries = [
    entry("pack.yaml", "name: agentic-coding\nversion: 0.2.0\n", 1, { mode: "100755" }),
    entry("decisions.yaml", "[]\n", 2),
  ];
  for (let index = 0; index < practiceCount; index += 1) {
    entries.push(
      entry(
        `practices/practice-${index.toString().padStart(2, "0")}.md`,
        `Practice ${index}\n`,
        index + 3,
      ),
    );
  }
  entries.push(entry("ignored.bin", "not materialized", practiceCount + 3));
  return entries.reverse();
}

class FakeGit {
  readonly calls: GitCall[] = [];
  batchOutput?: (objectIds: readonly string[]) => Uint8Array;
  cloneError?: Error;
  fetchError?: Error;

  constructor(readonly entries: readonly TreeEntry[]) {}

  readonly run: MaterializeGitRunner = async (gitArguments, options) => {
    this.calls.push({
      args: [...gitArguments],
      ...(options?.input === undefined ? {} : { input: options.input }),
      ...(options?.outputLimit === undefined ? {} : { outputLimit: options.outputLimit }),
    });
    if (gitArguments.includes("clone")) {
      if (this.cloneError !== undefined) throw this.cloneError;
      return new Uint8Array();
    }
    if (gitArguments.includes("rev-parse")) return bytes(`${resolvedCommit}\n`);
    if (gitArguments.includes("ls-tree")) {
      return bytes(
        this.entries
          .map(
            (source) =>
              `${source.mode} ${source.type} ${source.objectId}\t${source.path}${String.fromCharCode(0)}`,
          )
          .join(""),
      );
    }
    if (gitArguments.includes("fetch")) {
      if (this.fetchError !== undefined) throw this.fetchError;
      return new Uint8Array();
    }
    if (gitArguments.some((argument) => argument.startsWith("--batch="))) {
      const objectIds = this.readObjectIds(options?.input);
      return this.batchOutput?.(objectIds) ?? this.encodeBatch(objectIds);
    }
    throw new Error(`Unexpected Git command: ${gitArguments.join(" ")}`);
  };

  private readObjectIds(input: Uint8Array | undefined): string[] {
    if (input === undefined) throw new Error("Expected object ids on stdin");
    return new TextDecoder().decode(input).trimEnd().split("\n");
  }

  private encodeBatch(objectIds: readonly string[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    for (const id of objectIds) {
      const source = this.entries.find((candidate) => candidate.objectId === id);
      if (source === undefined) {
        chunks.push(bytes(`${id} missing\n`));
        continue;
      }
      chunks.push(
        bytes(`${id} ${source.type} ${source.contents.byteLength}\n`),
        source.contents,
        bytes("\n"),
      );
    }
    return concat(chunks);
  }

  callsFor(command: string): GitCall[] {
    return this.calls.filter((call) =>
      command === "cat-file"
        ? call.args.some((argument) => argument.startsWith("--batch="))
        : call.args.includes(command),
    );
  }

  temporaryRoot(): string {
    const clone = this.callsFor("clone")[0];
    if (clone === undefined) throw new Error("clone was not called");
    return dirname(clone.args.at(-1)!);
  }
}

function inputLines(call: GitCall): string[] {
  if (call.input === undefined) throw new Error("Expected Git stdin");
  return new TextDecoder().decode(call.input).trimEnd().split("\n");
}

async function setupGit(directory: string, gitArguments: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn(["git", ...gitArguments], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${gitArguments[0] ?? "command"} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

test("materializes many Pack blobs with one exact acquisition and one local batch read", async () => {
  const git = new FakeGit(packEntries());
  const source = await materializeRegistryRelease(release, repository, git.run);
  try {
    expect(source.resolvedCommit).toBe(resolvedCommit);
    expect(await Bun.file(join(source.directory, "pack.yaml")).text()).toContain(
      "name: agentic-coding",
    );
    expect(await Bun.file(join(source.directory, "decisions.yaml")).text()).toBe("[]\n");
    const practiceContents = await Promise.all(
      Array.from({ length: 29 }, (_, index) =>
        Bun.file(
          join(source.directory, "practices", `practice-${index.toString().padStart(2, "0")}.md`),
        ).text(),
      ),
    );
    for (const [index, contents] of practiceContents.entries()) {
      expect(contents).toBe(`Practice ${index}\n`);
    }
    expect(await Bun.file(join(source.directory, "ignored.bin")).exists()).toBe(false);

    expect(git.calls).toHaveLength(5);
    expect(git.callsFor("fetch")).toHaveLength(1);
    expect(git.callsFor("cat-file")).toHaveLength(1);
    const fetched = inputLines(git.callsFor("fetch")[0]!);
    const read = inputLines(git.callsFor("cat-file")[0]!);
    expect(fetched).toEqual(read);
    expect(fetched).toHaveLength(31);
    expect(git.callsFor("fetch")[0]?.args).toContain("fetch.negotiationAlgorithm=noop");
    expect(git.callsFor("fetch")[0]?.args).toContain("--filter=blob:none");
    expect(git.callsFor("fetch")[0]?.args).toContain("--no-auto-gc");
    expect(git.callsFor("cat-file")[0]?.args[0]).toBe("-C");
    expect(git.callsFor("cat-file")[0]?.outputLimit).toBe(
      defaultPackDirectoryLimits.maxTotalBytes + fetched.length * 128,
    );
    expect(git.calls.some((call) => call.args.includes("checkout"))).toBe(false);
  } finally {
    const temporaryRoot = git.temporaryRoot();
    await source.cleanup();
    expect(await Bun.file(temporaryRoot).exists()).toBe(false);
  }
});

test("production runner materializes a filtered local Git remote through batch stdin", async () => {
  const parent = await mkdtemp(join(tmpdir(), "lorelum-materialize-git-test-"));
  const sourceRepository = join(parent, "source");
  const remoteRepository = join(parent, "remote.git");
  await mkdir(join(sourceRepository, release.path, "practices"), { recursive: true });
  await setupGit(sourceRepository, ["init", "-b", "main"]);
  await writeFile(
    join(sourceRepository, release.path, "pack.yaml"),
    "name: agentic-coding\nversion: 0.2.0\n",
  );
  await writeFile(
    join(sourceRepository, release.path, "practices", "需求.md"),
    "Unicode Practice from a promisor remote.\n",
  );
  await writeFile(
    join(sourceRepository, release.path, "ignored.bin"),
    "Repository content outside the Pack materialization contract.\n",
  );
  await setupGit(sourceRepository, ["add", "."]);
  await setupGit(sourceRepository, [
    "-c",
    "user.name=Lorelum Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  await setupGit(sourceRepository, ["tag", release.ref]);
  const expectedCommit = await setupGit(sourceRepository, ["rev-parse", "HEAD"]);
  await setupGit(parent, ["clone", "--bare", "--", sourceRepository, remoteRepository]);
  await setupGit(parent, ["-C", remoteRepository, "config", "uploadpack.allowFilter", "true"]);

  let source: Awaited<ReturnType<typeof materializeRegistryRelease>> | undefined;
  try {
    source = await materializeRegistryRelease(release, pathToFileURL(remoteRepository).href);
    expect(source.resolvedCommit).toBe(expectedCommit);
    expect(
      await setupGit(parent, [
        "-C",
        join(dirname(source.directory), "repository"),
        "config",
        "--get",
        "remote.origin.promisor",
      ]),
    ).toBe("true");
    expect(await Bun.file(join(source.directory, "pack.yaml")).text()).toContain(
      "name: agentic-coding",
    );
    expect(await Bun.file(join(source.directory, "practices", "需求.md")).text()).toBe(
      "Unicode Practice from a promisor remote.\n",
    );
    expect(await Bun.file(join(source.directory, "decisions.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(source.directory, "ignored.bin")).exists()).toBe(false);
    const temporaryRoot = dirname(source.directory);
    await source.cleanup();
    source = undefined;
    expect(await Bun.file(temporaryRoot).exists()).toBe(false);
  } finally {
    await source?.cleanup().catch(() => undefined);
    await rm(parent, { force: true, recursive: true });
  }
});

test("fetches a shared object once and reads it for every validated target", async () => {
  const sharedPractice = entry("practices/first.md", "Shared Practice contents.\n", 2);
  const git = new FakeGit([
    entry("pack.yaml", "name: fixture\nversion: 0.2.0\n", 1),
    sharedPractice,
    {
      ...entry("practices/second.md", "Shared Practice contents.\n", 3),
      objectId: sharedPractice.objectId,
    },
  ]);
  const source = await materializeRegistryRelease(release, repository, git.run);
  try {
    expect(inputLines(git.callsFor("fetch")[0]!)).toHaveLength(2);
    const readObjectIds = inputLines(git.callsFor("cat-file")[0]!);
    expect(readObjectIds).toHaveLength(3);
    expect(readObjectIds.filter((id) => id === sharedPractice.objectId)).toHaveLength(2);
    expect(await Bun.file(join(source.directory, "practices", "first.md")).text()).toBe(
      "Shared Practice contents.\n",
    );
    expect(await Bun.file(join(source.directory, "practices", "second.md")).text()).toBe(
      "Shared Practice contents.\n",
    );
  } finally {
    await source.cleanup();
  }
});

test("maps a missing release ref to source.unavailable and cleans the temporary source", async () => {
  const git = new FakeGit(packEntries());
  git.cloneError = new CliError(cliErrorCodes.sourceUnavailable, "mock unavailable source");
  await expect(materializeRegistryRelease(release, repository, git.run)).rejects.toMatchObject({
    code: "source.unavailable",
  });
  expect(await Bun.file(git.temporaryRoot()).exists()).toBe(false);
});

test("preserves source.unavailable from batched object acquisition", async () => {
  const git = new FakeGit(packEntries());
  git.fetchError = new CliError(cliErrorCodes.sourceUnavailable, "mock unavailable objects");
  await expect(materializeRegistryRelease(release, repository, git.run)).rejects.toMatchObject({
    code: "source.unavailable",
  });
  expect(git.callsFor("fetch")).toHaveLength(1);
  expect(git.callsFor("cat-file")).toHaveLength(0);
  expect(await Bun.file(git.temporaryRoot()).exists()).toBe(false);
});

test.each([
  {
    name: "malformed header",
    output: (id: string) => bytes(`${id} tree 0\n\n`),
  },
  {
    name: "wrong object id",
    output: () => bytes(`${"e".repeat(40)} blob 0\n\n`),
  },
  {
    name: "missing object output",
    output: (id: string) => bytes(`${id} missing\n`),
  },
  {
    name: "truncated contents",
    output: (id: string) => bytes(`${id} blob 10\nshort\n`),
  },
  {
    name: "unexpected trailing output",
    output: (id: string) => bytes(`${id} blob 0\n\nextra`),
  },
])("rejects $name from the local object batch", async ({ output }) => {
  const git = new FakeGit([entry("pack.yaml", "fixture", 1)]);
  git.batchOutput = ([id]) => output(id!);
  await expect(materializeRegistryRelease(release, repository, git.run)).rejects.toMatchObject({
    code: "source.invalid",
  });
  expect(git.callsFor("fetch")).toHaveLength(1);
  expect(git.callsFor("cat-file")).toHaveLength(1);
  expect(await Bun.file(git.temporaryRoot()).exists()).toBe(false);
});

test("rejects a blob over the per-file byte budget", async () => {
  const git = new FakeGit([
    entry("pack.yaml", new Uint8Array(defaultPackDirectoryLimits.maxFileBytes + 1), 1),
  ]);
  await expect(materializeRegistryRelease(release, repository, git.run)).rejects.toMatchObject({
    code: "source.invalid",
  });
});

test("rejects a batch over the total byte budget", async () => {
  const contents = new Uint8Array(defaultPackDirectoryLimits.maxFileBytes);
  const entries = [entry("pack.yaml", contents, 1)];
  for (let index = 0; index < 64; index += 1) {
    entries.push(entry(`practices/${index}.md`, contents, index + 2));
  }
  const git = new FakeGit(entries);
  await expect(materializeRegistryRelease(release, repository, git.run)).rejects.toMatchObject({
    code: "source.invalid",
  });
});

test.each([
  {
    name: "missing pack manifest",
    entries: [entry("practices/only.md", "practice", 1)],
  },
  {
    name: "non-regular Pack path",
    entries: [entry("pack.yaml", "target", 1, { mode: "120000" })],
  },
  {
    name: "path outside the selected subtree",
    entries: [{ ...entry("pack.yaml", "fixture", 1), path: "packs/other/pack.yaml" }],
  },
  {
    name: "duplicate materialized path",
    entries: [entry("pack.yaml", "one", 1), entry("pack.yaml", "two", 2)],
  },
])("rejects $name before object acquisition", async ({ entries }) => {
  const git = new FakeGit(entries);
  await expect(materializeRegistryRelease(release, repository, git.run)).rejects.toMatchObject({
    code: "source.invalid",
  });
  expect(git.callsFor("fetch")).toHaveLength(0);
  expect(git.callsFor("cat-file")).toHaveLength(0);
  expect(await Bun.file(git.temporaryRoot()).exists()).toBe(false);
});

test("rejects more than the bounded number of Practice paths before acquisition", async () => {
  const git = new FakeGit(packEntries(defaultPackDirectoryLimits.maxPracticeFiles + 1));
  await expect(materializeRegistryRelease(release, repository, git.run)).rejects.toMatchObject({
    code: "source.invalid",
  });
  expect(git.callsFor("fetch")).toHaveLength(0);
});
