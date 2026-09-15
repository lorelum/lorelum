import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { dump, JSON_SCHEMA, load } from "js-yaml";

import { MAX_CONFIG_BYTES } from "./document/load";

const PROJECT_COMMENT = "# Lorelum project configuration. Edit sections as needed.\n";
const PACK_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class ProjectConfigError extends Error {
  constructor() {
    super("The Lorelum project configuration is invalid or unreadable.");
    this.name = "ProjectConfigError";
  }
}

export interface ProjectPackConfig {
  readonly enabled?: boolean;
  readonly priority?: number;
}

/** A layer only declares the fields it changes; inheritance is resolved by Engine. */
export interface ProjectConfig {
  readonly inherit?: boolean;
  readonly base?: "user" | "none";
  readonly packs?: Readonly<Record<string, ProjectPackConfig>>;
}

export interface ProjectPaths {
  readonly rootDirectory: string;
  readonly lorelumDirectory: string;
  readonly configFile: string;
  readonly packsDirectory: string;
}

export interface ProjectConfigLoadResult {
  readonly state: "missing" | "valid" | "invalid";
  readonly config: ProjectConfig;
}

export interface InitializeProjectConfigResult {
  readonly created: boolean;
  readonly filePath: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezeConfig(config: ProjectConfig): ProjectConfig {
  const packs = config.packs;
  return Object.freeze({
    ...(config.inherit === undefined ? {} : { inherit: config.inherit }),
    ...(config.base === undefined ? {} : { base: config.base }),
    ...(packs === undefined
      ? {}
      : {
          packs: Object.freeze(
            Object.fromEntries(
              Object.entries(packs).map(([name, value]) => [name, Object.freeze({ ...value })]),
            ),
          ),
        }),
  });
}

/** Validate only the project-owned schema. Invalid layers are recoverable to callers. */
export function parseProjectConfig(value: unknown): ProjectConfig {
  if (!isPlainObject(value)) throw new ProjectConfigError();
  for (const key of Object.keys(value)) {
    if (key !== "inherit" && key !== "base" && key !== "packs") throw new ProjectConfigError();
  }

  const inherit = value.inherit;
  if (inherit !== undefined && typeof inherit !== "boolean") throw new ProjectConfigError();
  const base = value.base;
  if (base !== undefined && base !== "user" && base !== "none") throw new ProjectConfigError();

  const rawPacks = value.packs;
  if (rawPacks !== undefined && !isPlainObject(rawPacks)) throw new ProjectConfigError();
  const packs: Record<string, ProjectPackConfig> = Object.create(null) as Record<
    string,
    ProjectPackConfig
  >;
  if (rawPacks !== undefined) {
    for (const [name, rawSettings] of Object.entries(rawPacks)) {
      if (!PACK_NAME.test(name) || !isPlainObject(rawSettings)) throw new ProjectConfigError();
      for (const key of Object.keys(rawSettings)) {
        if (key !== "enabled" && key !== "priority") throw new ProjectConfigError();
      }
      const rawEnabled = rawSettings.enabled;
      const rawPriority = rawSettings.priority;
      if (rawEnabled !== undefined && typeof rawEnabled !== "boolean")
        throw new ProjectConfigError();
      if (
        rawPriority !== undefined &&
        (typeof rawPriority !== "number" ||
          !Number.isSafeInteger(rawPriority) ||
          !Number.isInteger(rawPriority))
      ) {
        throw new ProjectConfigError();
      }
      const enabled = rawEnabled as boolean | undefined;
      const priority = rawPriority as number | undefined;
      packs[name] = Object.freeze({
        ...(enabled === undefined ? {} : { enabled }),
        ...(priority === undefined ? {} : { priority }),
      });
    }
  }

  return freezeConfig({
    ...(inherit === undefined ? {} : { inherit }),
    ...(base === undefined ? {} : { base }),
    ...(rawPacks === undefined ? {} : { packs }),
  });
}

/** Resolve project-local paths only; it deliberately performs no discovery or I/O. */
export function resolveProjectPaths(rootDirectory: string): ProjectPaths {
  if (!isAbsolute(rootDirectory)) throw new ProjectConfigError();
  const root = resolve(rootDirectory);
  const lorelumDirectory = join(root, ".lorelum");
  return Object.freeze({
    rootDirectory: root,
    lorelumDirectory,
    configFile: join(lorelumDirectory, "config.yaml"),
    packsDirectory: join(lorelumDirectory, "packs"),
  });
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function openRegularFile(path: string): Promise<FileHandle | undefined> {
  const info = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw new ProjectConfigError();
  });
  if (info === undefined) return undefined;
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_CONFIG_BYTES) {
    throw new ProjectConfigError();
  }
  try {
    return await open(path, "r");
  } catch {
    throw new ProjectConfigError();
  }
}

/**
 * Read one optional `.lorelum/config.yaml` layer without creating it. A bad
 * project file is reported as `invalid`, so callers can preserve valid parent
 * configuration and expose a degraded warning instead of aborting a query.
 */
export async function loadProjectConfig(rootDirectory: string): Promise<ProjectConfigLoadResult> {
  const paths = resolveProjectPaths(rootDirectory);
  let file: FileHandle | undefined;
  try {
    const parent = await lstat(paths.lorelumDirectory).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw new ProjectConfigError();
    });
    if (parent === undefined) {
      return Object.freeze({ state: "missing", config: Object.freeze({}) });
    }
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw new ProjectConfigError();
    file = await openRegularFile(paths.configFile);
    if (file === undefined) return Object.freeze({ state: "missing", config: Object.freeze({}) });
    const source = await file.readFile("utf8");
    if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) throw new ProjectConfigError();
    const document = load(source, { schema: JSON_SCHEMA });
    const config = document === undefined ? Object.freeze({}) : parseProjectConfig(document);
    return Object.freeze({ state: "valid", config });
  } catch (error) {
    if (error instanceof ProjectConfigError) {
      return Object.freeze({ state: "invalid", config: Object.freeze({}) });
    }
    return Object.freeze({ state: "invalid", config: Object.freeze({}) });
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function requireProjectRoot(paths: ProjectPaths): Promise<void> {
  const info = await lstat(paths.rootDirectory).catch(() => undefined);
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory())
    throw new ProjectConfigError();
}

async function ensureProjectDirectory(paths: ProjectPaths): Promise<void> {
  const existing = await lstat(paths.lorelumDirectory).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw new ProjectConfigError();
  });
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new ProjectConfigError();
    return;
  }
  try {
    await mkdir(paths.lorelumDirectory, { mode: 0o755 });
  } catch (error) {
    if (
      !isMissing(error) &&
      !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")
    ) {
      throw new ProjectConfigError();
    }
  }
  const created = await lstat(paths.lorelumDirectory).catch(() => undefined);
  if (created === undefined || created.isSymbolicLink() || !created.isDirectory()) {
    throw new ProjectConfigError();
  }
}

function serializeProjectConfig(document: ProjectConfig): string {
  const config = parseProjectConfig(document);
  try {
    const source = `${PROJECT_COMMENT}${dump(config, { noRefs: true, lineWidth: -1 })}`;
    if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) throw new ProjectConfigError();
    return source;
  } catch (error) {
    if (error instanceof ProjectConfigError) throw error;
    throw new ProjectConfigError();
  }
}

/** Create a project config once. Existing files are always left untouched. */
export async function initializeProjectConfig(
  rootDirectory: string,
  document: ProjectConfig = {},
): Promise<InitializeProjectConfigResult> {
  const paths = resolveProjectPaths(rootDirectory);
  await requireProjectRoot(paths);
  await ensureProjectDirectory(paths);

  const existing = await lstat(paths.configFile).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw new ProjectConfigError();
  });
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isFile()) throw new ProjectConfigError();
    return Object.freeze({ created: false, filePath: paths.configFile });
  }

  const temporary = `${paths.configFile}.tmp-${randomUUID()}`;
  let created = false;
  try {
    const file = await open(temporary, "wx", 0o644);
    created = true;
    try {
      await file.writeFile(serializeProjectConfig(document), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, paths.configFile);
      return Object.freeze({ created: true, filePath: paths.configFile });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        return Object.freeze({ created: false, filePath: paths.configFile });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ProjectConfigError) throw error;
    throw new ProjectConfigError();
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
}
