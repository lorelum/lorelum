import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

import { dump, JSON_SCHEMA, load } from "js-yaml";

import { MAX_CONFIG_BYTES } from "./document/load";
import { resolveLorelumPaths } from "./paths/lorelum";

const CATALOG_COMMENT = "# Lorelum Registry source catalog. Managed by lore registry commands.\n";
const SCHEMA_VERSION = 1;
const ALIAS_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SCP_LOCATOR_PATTERN = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+:.+$/u;
const LOCK_WAIT_MS = 500;
const LOCK_RETRY_MS = 25;
const catalogMutationTails = new Map<string, Promise<void>>();

export interface RegistryCatalogOptions {
  readonly homeDirectory?: string;
}

export type RegistryCatalogSource =
  | Readonly<{ kind: "remote-git"; locator: string }>
  | Readonly<{ kind: "local-git"; worktree: string }>;

export interface RegistryCatalog {
  readonly defaultAlias?: string;
  readonly registries: Readonly<Record<string, RegistryCatalogSource>>;
}

export interface AddRegistryCatalogSourceResult {
  readonly catalog: RegistryCatalog;
  readonly idempotent: boolean;
}

export class RegistryCatalogError extends Error {
  constructor() {
    super("The Registry source catalog is invalid or unreadable.");
    this.name = "RegistryCatalogError";
  }
}

export class RegistryCatalogBusyError extends Error {
  constructor() {
    super("The Registry source catalog is busy.");
    this.name = "RegistryCatalogBusyError";
  }
}

export class RegistryCatalogConflictError extends Error {
  constructor() {
    super("The Registry alias already points to a different source.");
    this.name = "RegistryCatalogConflictError";
  }
}

export class RegistryCatalogNotFoundError extends Error {
  constructor() {
    super("The Registry alias is not configured.");
    this.name = "RegistryCatalogNotFoundError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezeCatalog(
  defaultAlias: string | undefined,
  registries: Readonly<Record<string, RegistryCatalogSource>>,
): RegistryCatalog {
  return Object.freeze({
    ...(defaultAlias === undefined ? {} : { defaultAlias }),
    registries: Object.freeze(
      Object.fromEntries(
        Object.entries(registries).map(([alias, source]) => [alias, Object.freeze({ ...source })]),
      ),
    ),
  });
}

function emptyCatalog(): RegistryCatalog {
  return freezeCatalog(undefined, {});
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function catalogFile(options: RegistryCatalogOptions): string {
  return resolve(resolveLorelumPaths(options.homeDirectory).registryCatalogFile);
}

function validateAlias(alias: string): void {
  if (!ALIAS_PATTERN.test(alias) || alias === "official") throw new RegistryCatalogError();
}

function hasForbiddenLocatorCharacters(value: string): boolean {
  return /[\p{Cc}\s\\]/u.test(value);
}

function validateRemoteRepositoryPath(pathname: string): void {
  if (!pathname.startsWith("/")) throw new RegistryCatalogError();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) throw new RegistryCatalogError();
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new RegistryCatalogError();
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded === "" ||
      decoded.includes("/") ||
      hasForbiddenLocatorCharacters(decoded)
    ) {
      throw new RegistryCatalogError();
    }
  }
  if (pathname.toLowerCase().includes("/.lorelum/registry.yaml")) {
    throw new RegistryCatalogError();
  }
}

/**
 * The catalog cannot depend on the CLI resolver, but it must reject unsafe
 * hand-edited values before `registry list` can ever echo them. The CLI still
 * owns full remote normalization and the final transport validation.
 */
function validateRemoteLocator(locator: string): void {
  if (locator === "" || hasForbiddenLocatorCharacters(locator)) throw new RegistryCatalogError();

  if (locator.startsWith("https://") || locator.startsWith("ssh://")) {
    const rawPathStart = locator.indexOf("/", locator.indexOf("://") + 3);
    const rawPath = rawPathStart === -1 ? "" : locator.slice(rawPathStart).split(/[?#]/u, 1)[0]!;
    validateRemoteRepositoryPath(rawPath);
    let url: URL;
    try {
      url = new URL(locator);
    } catch {
      throw new RegistryCatalogError();
    }
    const isHttps = url.protocol === "https:";
    const isSsh = url.protocol === "ssh:";
    if (
      (!isHttps && !isSsh) ||
      url.hostname === "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (isHttps && (url.username !== "" || url.password !== "")) ||
      (isSsh &&
        (url.password !== "" || (url.username !== "" && !/^[A-Za-z0-9._-]+$/u.test(url.username))))
    ) {
      throw new RegistryCatalogError();
    }
    return;
  }

  const separator = locator.indexOf(":");
  if (!SCP_LOCATOR_PATTERN.test(locator) || separator === -1) throw new RegistryCatalogError();
  const pathname = locator.slice(separator + 1);
  if (pathname.startsWith("/")) throw new RegistryCatalogError();
  validateRemoteRepositoryPath(`/${pathname}`);
}

function validateSource(source: RegistryCatalogSource): void {
  if (source.kind === "remote-git") {
    if (typeof source.locator !== "string") {
      throw new RegistryCatalogError();
    }
    validateRemoteLocator(source.locator);
    return;
  }
  if (
    source.kind !== "local-git" ||
    !isAbsolute(source.worktree) ||
    source.worktree.length === 0 ||
    hasForbiddenLocatorCharacters(source.worktree) ||
    resolve(source.worktree) !== source.worktree
  ) {
    throw new RegistryCatalogError();
  }
}

function sourcesEqual(left: RegistryCatalogSource, right: RegistryCatalogSource): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "remote-git"
      ? left.locator === (right as Extract<RegistryCatalogSource, { kind: "remote-git" }>).locator
      : left.worktree === (right as Extract<RegistryCatalogSource, { kind: "local-git" }>).worktree)
  );
}

function parseCatalog(value: unknown): RegistryCatalog {
  if (!isPlainObject(value)) throw new RegistryCatalogError();
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "schema_version" && key !== "default" && key !== "registries")) {
    throw new RegistryCatalogError();
  }
  if (value.schema_version !== SCHEMA_VERSION || !isPlainObject(value.registries)) {
    throw new RegistryCatalogError();
  }
  const defaultAlias = value.default;
  if (
    defaultAlias !== undefined &&
    (typeof defaultAlias !== "string" ||
      defaultAlias === "official" ||
      !ALIAS_PATTERN.test(defaultAlias))
  ) {
    throw new RegistryCatalogError();
  }

  const registries: Record<string, RegistryCatalogSource> = Object.create(null) as Record<
    string,
    RegistryCatalogSource
  >;
  for (const [alias, rawSource] of Object.entries(value.registries)) {
    validateAlias(alias);
    if (!isPlainObject(rawSource) || typeof rawSource.kind !== "string") {
      throw new RegistryCatalogError();
    }
    if (rawSource.kind === "remote-git") {
      if (
        Object.keys(rawSource).some((key) => key !== "kind" && key !== "locator") ||
        typeof rawSource.locator !== "string"
      ) {
        throw new RegistryCatalogError();
      }
      const source = Object.freeze({ kind: "remote-git" as const, locator: rawSource.locator });
      validateSource(source);
      registries[alias] = source;
      continue;
    }
    if (rawSource.kind === "local-git") {
      if (
        Object.keys(rawSource).some((key) => key !== "kind" && key !== "worktree") ||
        typeof rawSource.worktree !== "string"
      ) {
        throw new RegistryCatalogError();
      }
      const source = Object.freeze({ kind: "local-git" as const, worktree: rawSource.worktree });
      validateSource(source);
      registries[alias] = source;
      continue;
    }
    throw new RegistryCatalogError();
  }
  if (defaultAlias !== undefined && registries[defaultAlias] === undefined)
    throw new RegistryCatalogError();
  return freezeCatalog(defaultAlias, registries);
}

async function inspectParent(directory: string, create: boolean): Promise<void> {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  /* eslint-disable no-await-in-loop -- each parent must be checked before its child. */
  for (const part of absolute
    .slice(root.length)
    .split(/[\\/]+/u)
    .filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw new RegistryCatalogError();
    });
    if (info === undefined) {
      if (!create) return;
      await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
        if (
          !isMissing(error) &&
          !(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EEXIST"
          )
        ) {
          throw new RegistryCatalogError();
        }
      });
      const created = await lstat(current).catch(() => undefined);
      if (
        created === undefined ||
        !created.isDirectory() ||
        created.isSymbolicLink() ||
        (current === absolute && process.platform !== "win32" && (created.mode & 0o077) !== 0)
      ) {
        throw new RegistryCatalogError();
      }
      continue;
    }
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (current === absolute && process.platform !== "win32" && (info.mode & 0o077) !== 0)
    ) {
      throw new RegistryCatalogError();
    }
  }
  /* eslint-enable no-await-in-loop */
}

async function openExistingCatalog(path: string): Promise<FileHandle | undefined> {
  const info = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw new RegistryCatalogError();
  });
  if (info === undefined) return undefined;
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES) {
    throw new RegistryCatalogError();
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new RegistryCatalogError();
  try {
    return await open(path, "r");
  } catch {
    throw new RegistryCatalogError();
  }
}

async function readCatalogFile(path: string): Promise<RegistryCatalog> {
  await inspectParent(dirname(path), false);
  const file = await openExistingCatalog(path);
  if (file === undefined) return emptyCatalog();
  try {
    const source = await file.readFile("utf8");
    if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) throw new RegistryCatalogError();
    const value = load(source, { schema: JSON_SCHEMA });
    return parseCatalog(value);
  } catch (error) {
    if (error instanceof RegistryCatalogError) throw error;
    throw new RegistryCatalogError();
  } finally {
    await file.close().catch(() => undefined);
  }
}

function serializeCatalog(catalog: RegistryCatalog): string {
  const document = {
    schema_version: SCHEMA_VERSION,
    ...(catalog.defaultAlias === undefined ? {} : { default: catalog.defaultAlias }),
    registries: Object.fromEntries(Object.entries(catalog.registries)),
  };
  try {
    const source = `${CATALOG_COMMENT}${dump(document, { noRefs: true, lineWidth: -1 })}`;
    if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) throw new RegistryCatalogError();
    return source;
  } catch (error) {
    if (error instanceof RegistryCatalogError) throw error;
    throw new RegistryCatalogError();
  }
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  /* eslint-disable no-await-in-loop -- lock acquisition is a bounded serial retry. */
  for (;;) {
    try {
      const lock = await open(lockPath, "wx", 0o600);
      await lock.close();
      return async () => unlink(lockPath).catch(() => undefined);
    } catch (error) {
      if (
        !isMissing(error) &&
        !(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")
      ) {
        throw new RegistryCatalogError();
      }
      if (Date.now() >= deadline) throw new RegistryCatalogBusyError();
      await new Promise<void>((done) => setTimeout(done, LOCK_RETRY_MS));
    }
  }
  /* eslint-enable no-await-in-loop */
}

async function writeCatalogFile(path: string, catalog: RegistryCatalog): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  let created = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await file.writeFile(serializeCatalog(catalog), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    const existing = await lstat(path).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw new RegistryCatalogError();
    });
    if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) {
      throw new RegistryCatalogError();
    }
    await rename(temporary, path);
    created = false;
    await syncParentDirectory(path);
  } catch (error) {
    if (error instanceof RegistryCatalogError) throw error;
    throw new RegistryCatalogError();
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
}

/** Persist the renamed directory entry where the host filesystem supports it. */
async function syncParentDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  let directory: FileHandle | undefined;
  try {
    directory = await open(dirname(path), "r");
    await directory.sync();
  } catch (error) {
    // Some filesystems cannot sync directory descriptors. The preceding
    // rename remains atomic; retain the strongest available durability.
    if (["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(errorCode(error) ?? "")) return;
    throw new RegistryCatalogError();
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

async function mutateCatalog<T>(
  options: RegistryCatalogOptions,
  mutate: (catalog: RegistryCatalog) => Readonly<{ catalog: RegistryCatalog; result: T }>,
): Promise<T> {
  const path = catalogFile(options);
  // Local writers queue instead of polling each other's lock and consuming the
  // external-writer deadline before their turn. Keep the file lock for other processes.
  const previous = catalogMutationTails.get(path);
  let finish!: () => void;
  const pending = new Promise<void>((done) => {
    finish = done;
  });
  catalogMutationTails.set(path, pending);
  await previous;
  try {
    await inspectParent(dirname(path), true);
    const release = await acquireLock(path);
    try {
      const current = await readCatalogFile(path);
      const next = mutate(current);
      if (next.catalog !== current) await writeCatalogFile(path, next.catalog);
      return next.result;
    } finally {
      await release();
    }
  } finally {
    finish();
    if (catalogMutationTails.get(path) === pending) catalogMutationTails.delete(path);
  }
}

export async function readRegistryCatalog(
  options: RegistryCatalogOptions = {},
): Promise<RegistryCatalog> {
  return readCatalogFile(catalogFile(options));
}

export async function addRegistryCatalogSource(
  alias: string,
  source: RegistryCatalogSource,
  options: RegistryCatalogOptions = {},
): Promise<AddRegistryCatalogSourceResult> {
  validateAlias(alias);
  validateSource(source);
  return mutateCatalog<AddRegistryCatalogSourceResult>(options, (catalog) => {
    const current = catalog.registries[alias];
    if (current !== undefined) {
      if (!sourcesEqual(current, source)) throw new RegistryCatalogConflictError();
      return Object.freeze({ catalog, result: Object.freeze({ catalog, idempotent: true }) });
    }
    const next = freezeCatalog(catalog.defaultAlias, { ...catalog.registries, [alias]: source });
    return Object.freeze({
      catalog: next,
      result: Object.freeze({ catalog: next, idempotent: false }),
    });
  });
}

export async function removeRegistryCatalogSource(
  alias: string,
  options: RegistryCatalogOptions = {},
): Promise<RegistryCatalog> {
  validateAlias(alias);
  return mutateCatalog(options, (catalog) => {
    if (catalog.registries[alias] === undefined) throw new RegistryCatalogNotFoundError();
    const registries = { ...catalog.registries };
    delete registries[alias];
    const next = freezeCatalog(
      catalog.defaultAlias === alias ? undefined : catalog.defaultAlias,
      registries,
    );
    return Object.freeze({ catalog: next, result: next });
  });
}

export async function setRegistryCatalogDefault(
  alias: string | undefined,
  options: RegistryCatalogOptions = {},
): Promise<RegistryCatalog> {
  if (alias !== undefined && alias !== "official") validateAlias(alias);
  return mutateCatalog(options, (catalog) => {
    const defaultAlias = alias === undefined || alias === "official" ? undefined : alias;
    if (defaultAlias !== undefined && catalog.registries[defaultAlias] === undefined) {
      throw new RegistryCatalogNotFoundError();
    }
    const next = freezeCatalog(defaultAlias, catalog.registries);
    return Object.freeze({ catalog: next, result: next });
  });
}
