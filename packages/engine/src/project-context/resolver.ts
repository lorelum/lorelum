import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

import {
  loadProjectConfig,
  resolveProjectPaths,
  type ProjectConfig,
  type ProjectPackConfig,
} from "@lorelum/config";

import { indexCorpusDigest } from "./cache";
import type { EffectivePractice } from "../local-store";
import { loadProjectPack, ProjectPackLoadError } from "./load-pack";
import {
  InvalidProjectRootError,
  type ContextSourceStatus,
  type EffectiveProjectConfig,
  type ProjectContextSnapshot,
  type ProjectContextWarning,
  type ResolveProjectContextOptions,
} from "./types";

interface Layer {
  readonly path: string;
  readonly depth: number;
  readonly config: ProjectConfig;
  readonly configInvalid: boolean;
}

interface Candidate {
  readonly effectivePractice: EffectivePractice;
  readonly source: EffectivePractice["sources"][number];
  readonly scope: "project" | "store";
  readonly packName: string;
  readonly layerDepth: number;
  readonly priority: number;
  readonly sourceKey: string;
}

function hash(parts: readonly string[]): string {
  const hasher = createHash("sha256");
  for (const part of parts) {
    hasher.update(part, "utf8");
    hasher.update("\0", "utf8");
  }
  return hasher.digest("hex");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function defaultConfig(): EffectiveProjectConfig {
  return Object.freeze({ base: "user", packs: Object.freeze({}) });
}

function mergeConfig(
  current: EffectiveProjectConfig,
  layer: ProjectConfig,
): EffectiveProjectConfig {
  const packs: Record<string, { enabled: boolean; priority: number }> = Object.create(
    null,
  ) as Record<string, { enabled: boolean; priority: number }>;
  for (const [name, settings] of Object.entries(current.packs)) packs[name] = { ...settings };
  for (const [name, raw] of Object.entries(layer.packs ?? {})) {
    const previous = packs[name] ?? { enabled: true, priority: 0 };
    packs[name] = {
      enabled: raw.enabled ?? previous.enabled,
      priority: raw.priority ?? previous.priority,
    };
  }
  return Object.freeze({
    base: layer.base ?? current.base,
    packs: Object.freeze(
      Object.fromEntries(
        Object.entries(packs).map(([name, settings]) => [name, Object.freeze(settings)]),
      ),
    ),
  });
}

async function directLayer(path: string): Promise<boolean> {
  const marker = await lstat(join(path, ".lorelum")).catch(() => undefined);
  return marker !== undefined && marker.isDirectory() && !marker.isSymbolicLink();
}

async function resolvedDirectory(path: string): Promise<string | undefined> {
  const resolved = await realpath(path).catch(() => undefined);
  if (resolved === undefined) return undefined;
  const info = await lstat(resolved).catch(() => undefined);
  return info?.isDirectory() ? resolved : undefined;
}

async function discoverLayerPaths(startDirectory: string): Promise<readonly string[]> {
  const start = await resolvedDirectory(startDirectory);
  if (start === undefined) return Object.freeze([]);
  const paths: string[] = [];
  for (let current = start; ; current = dirname(current)) {
    if (await directLayer(current)) paths.push(current);
    if (current === parse(current).root) break;
  }
  paths.reverse();
  return Object.freeze(paths);
}

async function explicitLayerPath(projectRoot: string): Promise<string> {
  const path = await resolvedDirectory(projectRoot);
  if (path === undefined || !(await directLayer(path))) throw new InvalidProjectRootError();
  return path;
}

async function loadLayers(paths: readonly string[]): Promise<{
  readonly layers: readonly Layer[];
  readonly warnings: readonly ProjectContextWarning[];
}> {
  const layers: Layer[] = [];
  const warnings: ProjectContextWarning[] = [];
  for (const [depth, path] of paths.entries()) {
    // eslint-disable-next-line no-await-in-loop -- layer fold is ordered by parent-to-child precedence.
    const loaded = await loadProjectConfig(path);
    const layer: Layer = Object.freeze({
      path,
      depth,
      config: loaded.config,
      configInvalid: loaded.state === "invalid",
    });
    if (layer.config.inherit === false) {
      layers.length = 0;
      warnings.length = 0;
    }
    layers.push(layer);
    if (layer.configInvalid) warnings.push({ code: "config.invalid", layerDepth: depth });
  }
  return Object.freeze({ layers: Object.freeze(layers), warnings: Object.freeze(warnings) });
}

async function listPackDirectories(layer: Layer): Promise<{
  readonly directories: readonly string[];
  readonly unsafeEntryFound: boolean;
}> {
  const directory = resolveProjectPaths(layer.path).packsDirectory;
  const info = await lstat(directory).catch(() => undefined);
  if (info === undefined)
    return Object.freeze({ directories: Object.freeze([]), unsafeEntryFound: false });
  if (info.isSymbolicLink() || !info.isDirectory()) throw new ProjectPackLoadError();
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) throw new ProjectPackLoadError();
  return Object.freeze({
    directories: Object.freeze(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => join(directory, entry.name))
        .sort(compareCodeUnits),
    ),
    unsafeEntryFound: entries.some((entry) => entry.isSymbolicLink()),
  });
}

function candidateOrder(left: Candidate, right: Candidate): number {
  if (left.scope !== right.scope) return left.scope === "project" ? -1 : 1;
  return (
    right.priority - left.priority ||
    right.layerDepth - left.layerDepth ||
    compareCodeUnits(left.sourceKey, right.sourceKey)
  );
}

function sourceStatus(candidate: Candidate, status: "active" | "shadowed"): ContextSourceStatus {
  return Object.freeze({
    scope: candidate.scope,
    status,
    packName: candidate.packName,
    practiceId: candidate.effectivePractice.practiceId,
    sourcePath: candidate.source.sourcePath,
    ...(candidate.scope === "project" ? { layerDepth: candidate.layerDepth } : {}),
  });
}

function effectiveSettings(config: EffectiveProjectConfig, packName: string): ProjectPackConfig {
  const settings = config.packs[packName];
  return settings === undefined ? {} : settings;
}

export async function resolveProjectContext(
  options: ResolveProjectContextOptions,
): Promise<ProjectContextSnapshot | undefined> {
  if (options.noProject === true) return undefined;
  const leaf =
    options.projectRoot === undefined ? undefined : await explicitLayerPath(options.projectRoot);
  const discovered =
    leaf === undefined
      ? await discoverLayerPaths(options.startDirectory ?? process.cwd())
      : await discoverLayerPaths(leaf);
  if (discovered.length === 0) return undefined;
  const leafPath = discovered.at(-1);
  if (leafPath === undefined) return undefined;
  const loaded = await loadLayers(discovered);
  if (loaded.layers.length === 0) return undefined;
  let config = defaultConfig();
  for (const layer of loaded.layers) config = mergeConfig(config, layer.config);

  const warnings = [...loaded.warnings];
  const candidates: Candidate[] = [];
  const statuses: ContextSourceStatus[] = [];
  for (const layer of loaded.layers) {
    let directories: readonly string[];
    try {
      // eslint-disable-next-line no-await-in-loop -- preserve a bounded layer traversal.
      const discoveredPacks = await listPackDirectories(layer);
      directories = discoveredPacks.directories;
      if (discoveredPacks.unsafeEntryFound) {
        warnings.push({ code: "source.unsafe", layerDepth: layer.depth });
      }
    } catch {
      warnings.push({ code: "source.unsafe", layerDepth: layer.depth });
      continue;
    }
    for (const directory of directories) {
      try {
        // eslint-disable-next-line no-await-in-loop -- each Pack has an independent bounded decode budget.
        const loadedPack = await loadProjectPack(directory);
        const settings = effectiveSettings(config, loadedPack.pack.name);
        if (settings.enabled === false) continue;
        for (const ignored of loadedPack.ignoredPracticeIds) {
          warnings.push({
            code: "practice.invalid",
            layerDepth: layer.depth,
            packName: loadedPack.pack.name,
            practiceId: ignored,
          });
          statuses.push({
            scope: "project",
            status: "ignored",
            layerDepth: layer.depth,
            packName: loadedPack.pack.name,
            practiceId: ignored,
          });
        }
        for (const effectivePractice of loadedPack.practices) {
          const source = effectivePractice.sources[0];
          if (source === undefined) continue;
          candidates.push({
            effectivePractice,
            source,
            scope: "project",
            packName: loadedPack.pack.name,
            layerDepth: layer.depth,
            priority: settings.priority ?? 0,
            sourceKey: `${loadedPack.pack.name}/${directory}/${source.sourcePath}`,
          });
        }
      } catch {
        warnings.push({ code: "pack.invalid", layerDepth: layer.depth });
      }
    }
  }

  if (config.base === "user") {
    const storeSnapshot = await options.store.readEffectivePracticeSnapshot(options.storageRoot);
    for (const effectivePractice of storeSnapshot.practices) {
      const source = effectivePractice.sources[0];
      if (source === undefined) continue;
      candidates.push({
        effectivePractice,
        source,
        scope: "store",
        packName: source.packName,
        layerDepth: -1,
        priority: Number.NEGATIVE_INFINITY,
        sourceKey: `${source.packName}/${source.sourcePath}`,
      });
    }
  }

  const byPractice = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const existing = byPractice.get(candidate.effectivePractice.practiceId);
    if (existing === undefined) byPractice.set(candidate.effectivePractice.practiceId, [candidate]);
    else existing.push(candidate);
  }
  const practices: EffectivePractice[] = [];
  for (const [practiceId, group] of byPractice) {
    const ordered = [...group].sort(candidateOrder);
    const winner = ordered[0];
    if (winner === undefined) continue;
    practices.push(winner.effectivePractice);
    statuses.push(sourceStatus(winner, "active"));
    for (const candidate of ordered.slice(1)) statuses.push(sourceStatus(candidate, "shadowed"));
    void practiceId;
  }
  practices.sort((left, right) => compareCodeUnits(left.practiceId, right.practiceId));
  const projectRootId = hash(["project-context-root/v1", await realpath(leafPath)]);
  const corpusDigest = indexCorpusDigest(practices);
  const contextDigest = hash([
    "project-context-snapshot/v1",
    projectRootId,
    JSON.stringify(config),
    corpusDigest,
  ]);
  return Object.freeze({
    kind: "project",
    projectRootId,
    projectRootPath: leafPath,
    layers: Object.freeze(loaded.layers.map((layer) => Object.freeze({ depth: layer.depth }))),
    effectiveConfig: config,
    practices: Object.freeze(practices),
    sources: Object.freeze(
      statuses.sort((left, right) => {
        return (
          compareCodeUnits(left.practiceId ?? "", right.practiceId ?? "") ||
          compareCodeUnits(left.packName, right.packName) ||
          compareCodeUnits(left.sourcePath ?? "", right.sourcePath ?? "")
        );
      }),
    ),
    contextDigest,
    indexCorpusDigest: corpusDigest,
    state: warnings.length === 0 ? "ready" : "degraded",
    warnings: Object.freeze(warnings),
  });
}
