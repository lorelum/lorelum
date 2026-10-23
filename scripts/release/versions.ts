import { readFile as readFileFromDisk, writeFile as writeFileToDisk } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { normalizeVersion } from "../../packages/cli/src/update/version-catalog.js";

export type Artifact = "cli" | "codex" | "zcode" | "cursor" | "workbuddy" | "claude" | "omp";

export type ChangeRequest =
  | { readonly action: "prepare"; readonly targets: ReadonlyMap<Artifact, string> }
  | { readonly action: "docs"; readonly cli: string };

export type ParsedCommand =
  | {
      readonly action: "prepare";
      readonly request: Extract<ChangeRequest, { action: "prepare" }>;
      readonly dryRun: boolean;
    }
  | {
      readonly action: "docs";
      readonly request: Extract<ChangeRequest, { action: "docs" }>;
      readonly dryRun: boolean;
    }
  | { readonly action: "check" };

export type FileEdit = Readonly<{ path: string; before: string; after: string }>;
export type Diagnostic = Readonly<{ path: string; message: string }>;
export type ReadFile = (path: string) => Promise<string>;
export type WriteFile = (path: string, contents: string) => Promise<void>;

const readTextFile: ReadFile = async (path) => readFileFromDisk(path, "utf8");

type MarketplaceMirror = Readonly<{
  kind: "marketplace";
  path: string;
  source: string;
}>;
type LockfileMirror = Readonly<{ kind: "lockfile"; path: "bun.lock" }>;
type ArtifactDefinition = Readonly<{
  manifestPath: string;
  mirror?: MarketplaceMirror | LockfileMirror;
}>;

const PUBLIC_RELEASE_PATH = "apps/site/content/public-release.json";
const CLI_LOCK_WORKSPACE = "packages/cli";
const CLI_LOCK_FIELD = 'workspaces["packages/cli"].version';

const ARTIFACTS: Record<Artifact, ArtifactDefinition> = {
  cli: {
    manifestPath: "packages/cli/package.json",
    mirror: { kind: "lockfile", path: "bun.lock" },
  },
  codex: { manifestPath: "plugins/codex/lorelum/.codex-plugin/plugin.json" },
  zcode: {
    manifestPath: "plugins/zcode/lorelum/.zcode-plugin/plugin.json",
    mirror: {
      kind: "marketplace",
      path: "marketplace.json",
      source: "./plugins/zcode/lorelum",
    },
  },
  cursor: {
    manifestPath: "plugins/cursor/lorelum/.cursor-plugin/plugin.json",
    mirror: {
      kind: "marketplace",
      path: ".cursor-plugin/marketplace.json",
      source: "./plugins/cursor/lorelum",
    },
  },
  workbuddy: {
    manifestPath: "plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json",
    mirror: {
      kind: "marketplace",
      path: ".codebuddy-plugin/marketplace.json",
      source: "./plugins/workbuddy/lorelum",
    },
  },
  claude: {
    manifestPath: "plugins/claude/lorelum/.claude-plugin/plugin.json",
    mirror: {
      kind: "marketplace",
      path: ".claude-plugin/marketplace.json",
      source: "./plugins/claude/lorelum",
    },
  },
  omp: {
    manifestPath: "plugins/omp/lorelum/package.json",
    mirror: {
      kind: "marketplace",
      path: ".omp-plugin/marketplace.json",
      source: "./plugins/omp/lorelum",
    },
  },
};

const ARTIFACT_ORDER = Object.keys(ARTIFACTS) as Artifact[];
const OPTION_TO_ARTIFACT: Readonly<Record<string, Artifact>> = {
  "--cli": "cli",
  "--codex": "codex",
  "--zcode": "zcode",
  "--cursor": "cursor",
  "--workbuddy": "workbuddy",
  "--claude": "claude",
  "--omp": "omp",
};

export class VersionToolError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join("\n"));
    this.name = "VersionToolError";
    this.diagnostics = diagnostics;
  }
}

function formatDiagnostic(item: Diagnostic): string {
  return `${item.path}: ${item.message}`;
}

function displayPath(root: string, path: string): string {
  return relative(resolve(root), path) || path;
}

function diagnostic(path: string, field: string, message: string): Diagnostic {
  return { path, message: `${field}: ${message}` };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new VersionToolError([diagnostic(path, field, "预期为 JSON object")]);
  }
  return value;
}

function requireVersion(value: unknown, path: string, field: string): string {
  if (typeof value !== "string" || normalizeVersion(value) !== value) {
    throw new VersionToolError([
      diagnostic(path, field, `预期为不带 v 的完整 SemVer，实际为 ${JSON.stringify(value)}`),
    ]);
  }
  return value;
}

function validateTargetVersion(value: string, option: string): string {
  if (normalizeVersion(value) !== value) {
    throw new Error(`${option}: 需要不带 v 的完整 SemVer，收到 ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseArguments(args: readonly string[]): ParsedCommand {
  const [action, ...options] = args;
  if (action !== "prepare" && action !== "docs" && action !== "check") {
    throw new Error("需要指定 prepare、docs 或 check");
  }

  if (action === "check") {
    if (options.length > 0) throw new Error(`check 不接受参数：${options[0]}`);
    return { action };
  }

  const targets = new Map<Artifact, string>();
  let dryRun = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]!;
    if (option === "--dry-run") {
      if (dryRun) throw new Error("--dry-run 重复指定");
      dryRun = true;
      continue;
    }

    const artifact = OPTION_TO_ARTIFACT[option];
    if (artifact === undefined || (action === "docs" && artifact !== "cli")) {
      throw new Error(`${action} 不支持参数 ${option}`);
    }
    if (targets.has(artifact)) throw new Error(`${option} 重复指定`);

    const value = options[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${option} 后必须提供一个版本`);
    }
    targets.set(artifact, validateTargetVersion(value, option));
    index += 1;
  }

  if (action === "prepare") {
    if (targets.size === 0) throw new Error("prepare 至少需要选择一个发布物");
    return { action, request: { action, targets }, dryRun };
  }

  const cli = targets.get("cli");
  if (cli === undefined) throw new Error("docs 必须指定 --cli <version>");
  return { action, request: { action, cli }, dryRun };
}

function parseJson(content: string, path: string, field: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new VersionToolError([diagnostic(path, field, `JSON 无法解析：${describeError(error)}`)]);
  }
}

function parseJsonc(content: string, path: string, field: string): unknown {
  try {
    return Bun.JSONC.parse(content) as unknown;
  } catch (error) {
    throw new VersionToolError([
      diagnostic(path, field, `JSONC 无法解析：${describeError(error)}`),
    ]);
  }
}

async function readText(
  root: string,
  path: string,
  field: string,
  read: ReadFile = readTextFile,
): Promise<string> {
  try {
    return await read(resolve(root, path));
  } catch (error) {
    throw new VersionToolError([diagnostic(path, field, `读取失败：${describeError(error)}`)]);
  }
}

type Span = Readonly<{ start: number; end: number }>;
type StringSpan = Span & Readonly<{ value: string }>;
type TextProperty = Readonly<{ key: string; value: Span }>;
type StoredVersion = Readonly<{ content: string; version: string; span: StringSpan }>;
type ParsedObject = Readonly<{
  value: Record<string, unknown>;
  span: Span;
  cursor: JsonCursor;
  properties: readonly TextProperty[];
}>;

class JsonCursor {
  constructor(private readonly source: string) {}

  skipTrivia(start: number): number {
    let index = start;
    while (index < this.source.length) {
      if (/\s/.test(this.source[index]!)) {
        index += 1;
      } else if (this.source.startsWith("//", index)) {
        let lineEnd = index + 2;
        while (
          lineEnd < this.source.length &&
          !"\r\n\u2028\u2029".includes(this.source[lineEnd]!)
        ) {
          lineEnd += 1;
        }
        index = Math.min(lineEnd + 1, this.source.length);
      } else if (this.source.startsWith("/*", index)) {
        const close = this.source.indexOf("*/", index + 2);
        index = close < 0 ? this.source.length : close + 2;
      } else {
        break;
      }
    }
    return index;
  }

  stringEnd(start: number): number {
    for (let index = start + 1; index < this.source.length; index += 1) {
      if (this.source[index] === "\\") index += 1;
      else if (this.source[index] === '"') return index + 1;
    }
    return this.source.length;
  }

  valueEnd(start: number): number {
    const valueStart = this.skipTrivia(start);
    const character = this.source[valueStart];
    if (character === '"') return this.stringEnd(valueStart);
    if (character === "{" || character === "[") return this.matchingDelimiter(valueStart) + 1;

    let index = valueStart;
    while (index < this.source.length) {
      const next = this.skipTrivia(index);
      if (next !== index) {
        index = next;
        continue;
      }
      if ([",", "}", "]"].includes(this.source[index]!)) return index;
      index += 1;
    }
    return index;
  }

  objectAt(start: number): Readonly<{ span: Span; properties: readonly TextProperty[] }> {
    const properties: TextProperty[] = [];
    let index = this.skipTrivia(start + 1);
    while (index < this.source.length && this.source[index] !== "}") {
      const keyEnd = this.stringEnd(index);
      const key = JSON.parse(this.source.slice(index, keyEnd)) as string;
      const colon = this.skipTrivia(keyEnd);
      const valueStart = this.skipTrivia(colon + 1);
      const valueEnd = this.valueEnd(valueStart);
      properties.push({ key, value: { start: valueStart, end: valueEnd } });
      index = this.skipTrivia(valueEnd);
      if (this.source[index] === ",") index = this.skipTrivia(index + 1);
    }
    return { span: { start, end: index + 1 }, properties };
  }

  arrayValues(array: Span): readonly Span[] {
    const values: Span[] = [];
    let index = this.skipTrivia(array.start + 1);
    while (index < array.end - 1 && this.source[index] !== "]") {
      const end = this.valueEnd(index);
      values.push({ start: this.skipTrivia(index), end });
      index = this.skipTrivia(end);
      if (this.source[index] === ",") index = this.skipTrivia(index + 1);
    }
    return values;
  }

  private matchingDelimiter(start: number): number {
    let depth = 0;
    for (let index = start; index < this.source.length;) {
      const next = this.skipTrivia(index);
      if (next !== index) {
        index = next;
        continue;
      }
      const character = this.source[index]!;
      if (character === '"') {
        index = this.stringEnd(index);
      } else if (character === "{" || character === "[") {
        depth += 1;
        index += 1;
      } else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) return index;
        index += 1;
      } else {
        index += 1;
      }
    }
    return this.source.length - 1;
  }
}

function parsedObject(content: string, path: string, field: string, jsonc = false): ParsedObject {
  const value = requireRecord(
    jsonc ? parseJsonc(content, path, field) : parseJson(content, path, field),
    path,
    field,
  );
  const cursor = new JsonCursor(content);
  const start = cursor.skipTrivia(0);
  const object = cursor.objectAt(start);
  return { value, ...object, cursor };
}

function objectProperty(
  document: ParsedObject,
  key: string,
  path: string,
  field: string,
): TextProperty {
  const matches = document.properties.filter((property) => property.key === key);
  if (matches.length !== 1) {
    throw new VersionToolError([
      diagnostic(path, field, `预期恰好一个直接字段，找到 ${matches.length} 个`),
    ]);
  }
  return matches[0]!;
}

function childObject(
  document: ParsedObject,
  key: string,
  value: unknown,
  path: string,
  field: string,
): ParsedObject {
  const record = requireRecord(value, path, field);
  const property = objectProperty(document, key, path, field);
  const object = document.cursor.objectAt(property.value.start);
  return { value: record, ...object, cursor: document.cursor };
}

function stringVersion(
  document: ParsedObject,
  key: string,
  path: string,
  field: string,
): StringSpan {
  const version = requireVersion(document.value[key], path, field);
  const property = objectProperty(document, key, path, field);
  return { start: property.value.start, end: property.value.end, value: version };
}

function lockfileVersion(content: string, path: string): StoredVersion {
  const document = parsedObject(content, path, "bun.lock", true);
  const workspaces = childObject(
    document,
    "workspaces",
    document.value.workspaces,
    path,
    "workspaces",
  );
  const workspace = childObject(
    workspaces,
    CLI_LOCK_WORKSPACE,
    workspaces.value[CLI_LOCK_WORKSPACE],
    path,
    CLI_LOCK_FIELD,
  );
  const span = stringVersion(workspace, "version", path, CLI_LOCK_FIELD);
  return { content, version: span.value, span };
}

function marketplaceVersion(content: string, path: string, source: string): StoredVersion {
  const document = parsedObject(content, path, "marketplace");
  const plugins = document.value.plugins;
  if (!Array.isArray(plugins)) {
    throw new VersionToolError([diagnostic(path, "plugins", "预期为数组")]);
  }
  const property = objectProperty(document, "plugins", path, "plugins");
  const entrySpans = document.cursor.arrayValues(property.value);
  if (entrySpans.length !== plugins.length) {
    throw new VersionToolError([diagnostic(path, "plugins", "文本 entry 数量与解析结果不一致")]);
  }

  const matches: { value: Record<string, unknown>; span: Span }[] = [];
  for (const [index, value] of plugins.entries()) {
    if (!isRecord(value)) {
      throw new VersionToolError([diagnostic(path, `plugins[${index}]`, "预期为 object")]);
    }
    if (value.name === "lorelum" && value.source === source) {
      matches.push({ value, span: entrySpans[index]! });
    }
  }
  const field = `plugins[name=lorelum, source=${source}].version`;
  if (matches.length !== 1) {
    throw new VersionToolError([
      diagnostic(path, field, `预期恰好一个所属 entry，找到 ${matches.length} 个`),
    ]);
  }

  const match = matches[0]!;
  const object = document.cursor.objectAt(match.span.start);
  const entry = { value: match.value, ...object, cursor: document.cursor };
  const span = stringVersion(entry, "version", path, field);
  return { content, version: span.value, span };
}

function publicVersion(content: string, path: string): StoredVersion {
  const document = parsedObject(content, path, "public release data");
  if (document.properties.length !== 1 || document.properties[0]?.key !== "cli") {
    throw new VersionToolError([
      diagnostic(path, "public-release.json", '预期只包含一个 "cli" 字段'),
    ]);
  }
  const span = stringVersion(document, "cli", path, "cli");
  return { content, version: span.value, span };
}

function replaceVersion(content: string, span: StringSpan, target: string): string {
  if (span.value === target) return content;
  return `${content.slice(0, span.start)}${JSON.stringify(target)}${content.slice(span.end)}`;
}

async function readManifest(
  root: string,
  artifact: Artifact,
  read: ReadFile,
): Promise<StoredVersion> {
  const path = ARTIFACTS[artifact].manifestPath;
  const content = await readText(root, path, "version", read);
  const document = parsedObject(content, path, "manifest");
  const span = stringVersion(document, "version", path, "version");
  return { content, version: span.value, span };
}

async function readMirror(
  root: string,
  mirror: MarketplaceMirror | LockfileMirror,
  read: ReadFile,
): Promise<StoredVersion> {
  const content = await readText(
    root,
    mirror.path,
    mirror.kind === "lockfile" ? CLI_LOCK_FIELD : "marketplace version",
    read,
  );
  return mirror.kind === "lockfile"
    ? lockfileVersion(content, mirror.path)
    : marketplaceVersion(content, mirror.path, mirror.source);
}

async function readArtifactVersions(
  root: string,
  artifact: Artifact,
  read: ReadFile,
): Promise<Readonly<{ manifest: StoredVersion; mirror?: StoredVersion }>> {
  const definition = ARTIFACTS[artifact];
  const manifest = await readManifest(root, artifact, read);
  if (definition.mirror === undefined) return { manifest };

  const mirror = await readMirror(root, definition.mirror, read);
  if (mirror.version !== manifest.version) {
    throw new VersionToolError([
      diagnostic(
        definition.mirror.path,
        definition.mirror.kind === "lockfile"
          ? CLI_LOCK_FIELD
          : `plugins[name=lorelum, source=${definition.mirror.source}].version`,
        `预期与原生 manifest ${definition.manifestPath}#version 一致（${manifest.version}），实际 ${mirror.version}`,
      ),
    ]);
  }
  return { manifest, mirror };
}

function addEdit(edits: Map<string, FileEdit>, path: string, before: string, after: string): void {
  if (before !== after) edits.set(path, { path, before, after });
}

function appendDiagnostics(target: Diagnostic[], error: unknown, root: string): void {
  if (error instanceof VersionToolError) {
    for (const item of error.diagnostics) {
      target.push({ ...item, path: displayPath(root, resolve(root, item.path)) });
    }
    return;
  }
  target.push({ path: ".", message: describeError(error) });
}

type VersionPlan = Readonly<{
  edits: readonly FileEdit[];
  previousVersions: ReadonlyMap<Artifact | "public-cli", string>;
}>;

export async function planVersionChange(
  root: string,
  request: ChangeRequest,
  read: ReadFile = readTextFile,
): Promise<VersionPlan> {
  const absoluteRoot = resolve(root);
  const edits = new Map<string, FileEdit>();
  const previousVersions = new Map<Artifact | "public-cli", string>();
  const diagnostics: Diagnostic[] = [];

  if (request.action === "prepare") {
    for (const [artifact, target] of request.targets) {
      try {
        const definition = ARTIFACTS[artifact];
        // oxlint-disable-next-line no-await-in-loop -- Preflight selected releases deterministically before any write.
        const { manifest, mirror } = await readArtifactVersions(absoluteRoot, artifact, read);
        previousVersions.set(artifact, manifest.version);
        if (definition.mirror !== undefined && mirror !== undefined) {
          const mirrorAfter = replaceVersion(mirror.content, mirror.span, target);
          addEdit(
            edits,
            resolve(absoluteRoot, definition.mirror.path),
            mirror.content,
            mirrorAfter,
          );
        }

        const manifestAfter = replaceVersion(manifest.content, manifest.span, target);
        addEdit(
          edits,
          resolve(absoluteRoot, definition.manifestPath),
          manifest.content,
          manifestAfter,
        );
      } catch (error) {
        appendDiagnostics(diagnostics, error, absoluteRoot);
      }
    }
  } else {
    try {
      const path = PUBLIC_RELEASE_PATH;
      const content = await readText(absoluteRoot, path, "cli", read);
      const current = publicVersion(content, path);
      previousVersions.set("public-cli", current.version);
      const after = replaceVersion(content, current.span, request.cli);
      addEdit(edits, resolve(absoluteRoot, path), content, after);
    } catch (error) {
      appendDiagnostics(diagnostics, error, absoluteRoot);
    }
  }

  if (diagnostics.length > 0) throw new VersionToolError(diagnostics);
  return { edits: [...edits.values()], previousVersions };
}

export async function checkVersions(
  root: string,
  read: ReadFile = readTextFile,
): Promise<readonly Diagnostic[]> {
  const absoluteRoot = resolve(root);
  const diagnostics: Diagnostic[] = [];
  for (const artifact of ARTIFACT_ORDER) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Keep the complete offline check deterministic.
      await readArtifactVersions(absoluteRoot, artifact, read);
    } catch (error) {
      appendDiagnostics(diagnostics, error, absoluteRoot);
    }
  }

  try {
    const content = await readText(absoluteRoot, PUBLIC_RELEASE_PATH, "cli", read);
    publicVersion(content, PUBLIC_RELEASE_PATH);
  } catch (error) {
    appendDiagnostics(diagnostics, error, absoluteRoot);
  }
  return diagnostics;
}

async function writeText(path: string, contents: string): Promise<void> {
  await writeFileToDisk(path, contents, "utf8");
}

export async function applyEdits(
  edits: readonly FileEdit[],
  write: WriteFile = writeText,
  read: ReadFile = readTextFile,
): Promise<void> {
  const changed = edits.filter((edit) => edit.before !== edit.after);
  const diagnostics: Diagnostic[] = [];
  for (const edit of changed) {
    let actual: string;
    try {
      // oxlint-disable-next-line no-await-in-loop -- Finish all content checks before starting the write phase.
      actual = await read(edit.path);
    } catch (error) {
      diagnostics.push({ path: edit.path, message: `写入前读取失败：${describeError(error)}` });
      continue;
    }
    if (actual !== edit.before) {
      diagnostics.push({ path: edit.path, message: "文件在预检后发生变化；未覆盖现有内容" });
    }
  }
  if (diagnostics.length > 0) throw new VersionToolError(diagnostics);

  const attempted: FileEdit[] = [];
  try {
    for (const edit of changed) {
      attempted.push(edit);
      // oxlint-disable-next-line no-await-in-loop -- Ordered writes define the recoverable attempted-file set.
      await write(edit.path, edit.after);
    }
  } catch (error) {
    const writeError = describeError(error);
    const recovered: string[] = [];
    const recoveryFailures: string[] = [];
    for (const edit of [...attempted].reverse()) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- Restore in reverse order, including the partially written file.
        await write(edit.path, edit.before);
        recovered.push(edit.path);
      } catch (restoreError) {
        recoveryFailures.push(`${edit.path}: ${describeError(restoreError)}`);
      }
    }
    const failedPath = attempted[attempted.length - 1]?.path ?? "未知路径";
    const recoverySummary =
      recoveryFailures.length === 0
        ? `已尝试恢复 ${recovered.length} 个文件（包括失败文件）`
        : `恢复失败：${recoveryFailures.join("；")}`;
    throw new VersionToolError([
      {
        path: failedPath,
        message: `写入失败：${writeError}；${recoverySummary}`,
      },
    ]);
  }
}

export type CommandResult = Readonly<{
  exitCode: number;
  output: readonly string[];
  errors: readonly string[];
}>;

export async function runVersionCommand(
  args: readonly string[],
  root: string,
  write: WriteFile = writeText,
  read: ReadFile = readTextFile,
): Promise<CommandResult> {
  const absoluteRoot = resolve(root);
  try {
    const command = parseArguments(args);
    if (command.action === "check") {
      const diagnostics = await checkVersions(absoluteRoot, read);
      if (diagnostics.length > 0) {
        return {
          exitCode: 1,
          output: [],
          errors: diagnostics.map(formatDiagnostic),
        };
      }
      return {
        exitCode: 0,
        output: ["所有已登记的原生版本关系及公开安装推荐格式均符合约定。"],
        errors: [],
      };
    }

    const plan = await planVersionChange(absoluteRoot, command.request, read);
    if (!command.dryRun) await applyEdits(plan.edits, write, read);

    const output = [
      command.dryRun
        ? `${command.action} 预览（未写入）`
        : `${command.action} 完成（仅修改本地文件，未发布或部署）`,
    ];
    if (command.action === "prepare") {
      for (const [artifact, target] of command.request.targets) {
        const old = plan.previousVersions.get(artifact)!;
        output.push(`${artifact}: ${old} → ${target}`);
      }
    } else {
      const old = plan.previousVersions.get("public-cli")!;
      output.push(`公开 CLI 推荐: ${old} → ${command.request.cli}`);
    }
    if (plan.edits.length === 0) {
      output.push("无改动。");
    } else {
      output.push("文件：");
      for (const edit of plan.edits) output.push(`- ${displayPath(absoluteRoot, edit.path)}`);
    }
    return { exitCode: 0, output, errors: [] };
  } catch (error) {
    return {
      exitCode: 1,
      output: [],
      errors:
        error instanceof VersionToolError ? error.message.split("\n") : [describeError(error)],
    };
  }
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, "../..");
  const result = await runVersionCommand(process.argv.slice(2), root);
  for (const line of result.output) console.log(line);
  for (const line of result.errors) console.error(line);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

if (import.meta.main) await main();
