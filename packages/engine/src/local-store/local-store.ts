import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { validatePack, type Practice, type ValidationReport } from "@lorelum/format";

import {
  artifactDigest,
  canonicalContent,
  contentDigest,
  normalizeSnapshotPath,
  storageKey,
} from "./canonicalize";
import {
  discardStagedArtifact,
  promoteArtifact,
  removeArtifact,
  stageArtifact,
} from "./artifact-store";
import { StoreDatabase } from "./database";
import {
  InvalidPreparedPackError,
  PackNotInstalledError,
  PackUpgradeRequiredError,
  PackValidationError,
  PracticeConflictError,
  StoreInvariantError,
} from "./errors";
import {
  emptyManifest,
  loadManifest,
  type InstalledPacksManifest,
  writeManifest,
} from "./manifest";
import { LocalStoreRepository } from "./repositories";
import type {
  EffectivePractice,
  InstallResult,
  InstalledPack,
  LocalStoreOpenOptions,
  LocalStoreState,
  PreparedPack,
  StorageRoot,
  UninstallResult,
} from "./types";

interface CandidatePractice {
  readonly practice: Practice;
  readonly canonicalContent: string;
  readonly contentDigest: string;
  readonly sourcePath: string;
}

interface PackCandidate {
  readonly prepared: PreparedPack;
  readonly artifactDigest: string;
  readonly storageKey: string;
  readonly validation: ValidationReport;
  readonly practices: readonly CandidatePractice[];
}

export function storageRoot(path: string): StorageRoot {
  return { path };
}

export function defaultStorageRoot(): StorageRoot {
  return storageRoot(join(homedir(), ".lorelum"));
}

export class LocalStore {
  private readonly repository: LocalStoreRepository;

  private constructor(
    readonly root: StorageRoot,
    private readonly database: StoreDatabase,
    private manifest: InstalledPacksManifest,
  ) {
    this.repository = new LocalStoreRepository(database.connection);
  }

  static async open(options: LocalStoreOpenOptions = {}): Promise<LocalStore> {
    const root = options.root ?? defaultStorageRoot();
    await mkdir(root.path, { recursive: true });
    const manifest = await loadManifest(root);
    const database = new StoreDatabase(root);
    const repository = new LocalStoreRepository(database.connection);
    const state = repository.state();

    if (state.installedPacksGeneration !== manifest.generation) {
      database.close();
      throw new StoreInvariantError(
        `SQLite generation ${state.installedPacksGeneration} does not match manifest generation ${manifest.generation}`,
      );
    }

    return new LocalStore(root, database, manifest);
  }

  close(): void {
    this.database.close();
  }

  state(): LocalStoreState {
    return this.repository.state();
  }

  installedPacks(): readonly InstalledPack[] {
    return this.repository.allInstalledPacks();
  }

  effectivePractices(): readonly EffectivePractice[] {
    return this.repository.allEffectivePractices();
  }

  effectivePractice(practiceId: string): EffectivePractice | null {
    return this.repository.effectivePractice(practiceId);
  }

  async install(prepared: PreparedPack): Promise<InstallResult> {
    const candidate = this.prepareCandidate(prepared);
    const existing = this.manifest.packs.find((pack) => pack.name === prepared.input.pack.name);
    if (existing !== undefined) {
      if (existing.artifactDigest === candidate.artifactDigest) {
        return {
          kind: "unchanged",
          pack: existing,
          effectiveRevision: this.repository.state().effectiveRevision,
          validation: candidate.validation,
        };
      }
      throw new PackUpgradeRequiredError(existing.name);
    }
    return this.applyCandidate("installed", candidate, undefined);
  }

  async upgrade(prepared: PreparedPack): Promise<InstallResult> {
    const candidate = this.prepareCandidate(prepared);
    const existing = this.manifest.packs.find((pack) => pack.name === prepared.input.pack.name);
    if (existing === undefined) {
      throw new PackNotInstalledError(prepared.input.pack.name);
    }
    if (existing.artifactDigest === candidate.artifactDigest) {
      return {
        kind: "unchanged",
        pack: existing,
        effectiveRevision: this.repository.state().effectiveRevision,
        validation: candidate.validation,
      };
    }
    return this.applyCandidate("upgraded", candidate, existing);
  }

  async uninstall(packName: string): Promise<UninstallResult> {
    const existing = this.manifest.packs.find((pack) => pack.name === packName);
    if (existing === undefined) throw new PackNotInstalledError(packName);

    const oldSources = this.repository.sourcesForPack(packName);
    const affectedPracticeIds = new Set(oldSources.map((source) => source.practice_id));
    const nextManifest = this.nextManifest(
      this.manifest.packs.filter((pack) => pack.name !== packName),
    );

    await writeManifest(this.root, nextManifest);
    const nextRevision = this.database.transaction(() => {
      const currentState = this.repository.state();
      this.repository.deletePack(packName);
      const effectiveChanged = this.reconcileEffectivePractices(affectedPracticeIds, new Map());
      const state = {
        installedPacksGeneration: nextManifest.generation,
        effectiveRevision: currentState.effectiveRevision + (effectiveChanged ? 1 : 0),
      };
      if (effectiveChanged) {
        this.rewriteChangedEffectiveRevisions(affectedPracticeIds, state.effectiveRevision);
      }
      this.repository.setState(state);
      return state.effectiveRevision;
    });

    this.manifest = nextManifest;
    await removeArtifact(this.root, existing.storageKey, existing.artifactDigest);
    return { packName, effectiveRevision: nextRevision };
  }

  private prepareCandidate(prepared: PreparedPack): PackCandidate {
    const validation = validatePack(prepared.input);
    if (!validation.valid) throw new PackValidationError(validation);

    const normalizedFiles = new Map<string, Uint8Array>();
    for (const file of prepared.files) {
      const path = normalizeSnapshotPath(file.relativePath);
      if (normalizedFiles.has(path)) {
        throw new InvalidPreparedPackError(`Duplicate snapshot path "${path}"`);
      }
      normalizedFiles.set(path, file.bytes);
    }
    if (!normalizedFiles.has("pack.yaml")) {
      throw new InvalidPreparedPackError('PreparedPack snapshot must contain "pack.yaml"');
    }
    if (prepared.practiceSourcePaths.size !== prepared.input.practices.length) {
      throw new InvalidPreparedPackError("Every Practice must have exactly one source path");
    }

    const practices: CandidatePractice[] = [];
    for (const practice of prepared.input.practices) {
      const sourcePath = prepared.practiceSourcePaths.get(practice.id);
      if (sourcePath === undefined) {
        throw new InvalidPreparedPackError(`Practice "${practice.id}" has no source path`);
      }
      const normalizedSourcePath = normalizeSnapshotPath(sourcePath);
      if (!normalizedFiles.has(normalizedSourcePath)) {
        throw new InvalidPreparedPackError(
          `Practice "${practice.id}" source path "${normalizedSourcePath}" is absent from snapshot`,
        );
      }
      practices.push({
        practice,
        sourcePath: normalizedSourcePath,
        canonicalContent: canonicalContent(practice),
        contentDigest: contentDigest(practice),
      });
    }

    return {
      prepared,
      artifactDigest: artifactDigest(prepared.files),
      storageKey: storageKey(prepared.input.pack.name),
      validation,
      practices,
    };
  }

  private async applyCandidate(
    kind: "installed" | "upgraded",
    candidate: PackCandidate,
    previous: InstalledPack | undefined,
  ): Promise<InstallResult> {
    this.assertNoConflicts(candidate, previous?.name);
    const operationId = crypto.randomUUID();
    const staged = await stageArtifact(this.root, operationId, candidate.prepared.files);
    const installedAt = new Date().toISOString();
    const pack: InstalledPack = {
      name: candidate.prepared.input.pack.name,
      version: candidate.prepared.input.pack.version,
      artifactDigest: candidate.artifactDigest,
      storageKey: candidate.storageKey,
      installedAt,
    };

    try {
      await promoteArtifact(this.root, staged, pack.storageKey, pack.artifactDigest);
      const nextManifest = this.nextManifest([
        ...this.manifest.packs.filter((entry) => entry.name !== pack.name),
        pack,
      ]);
      await writeManifest(this.root, nextManifest);

      const nextRevision = this.database.transaction(() => {
        const oldSources = this.repository.sourcesForPack(pack.name);
        const affectedPracticeIds = new Set([
          ...oldSources.map((source) => source.practice_id),
          ...candidate.practices.map((practice) => practice.practice.id),
        ]);
        const currentState = this.repository.state();
        this.repository.deletePack(pack.name);
        this.repository.savePack(pack);
        for (const practice of candidate.practices) {
          this.repository.addSource(
            pack.name,
            practice.practice.id,
            practice.contentDigest,
            practice.sourcePath,
          );
        }
        const candidatesById = new Map(
          candidate.practices.map((practice) => [practice.practice.id, practice]),
        );
        const effectiveChanged = this.reconcileEffectivePractices(
          affectedPracticeIds,
          candidatesById,
        );
        const state = {
          installedPacksGeneration: nextManifest.generation,
          effectiveRevision: currentState.effectiveRevision + (effectiveChanged ? 1 : 0),
        };
        if (effectiveChanged) {
          this.rewriteChangedEffectiveRevisions(
            affectedPracticeIds,
            state.effectiveRevision,
            candidatesById,
          );
        }
        this.repository.setState(state);
        return state.effectiveRevision;
      });

      this.manifest = nextManifest;
      if (previous !== undefined) {
        await removeArtifact(this.root, previous.storageKey, previous.artifactDigest);
      }
      return { kind, pack, effectiveRevision: nextRevision, validation: candidate.validation };
    } catch (error: unknown) {
      await discardStagedArtifact(this.root, staged);
      throw error;
    }
  }

  private assertNoConflicts(candidate: PackCandidate, ignoredPackName: string | undefined): void {
    for (const practice of candidate.practices) {
      for (const source of this.repository.sourcesForPractice(practice.practice.id)) {
        if (source.pack_name === ignoredPackName) continue;
        if (source.content_digest !== practice.contentDigest) {
          throw new PracticeConflictError(
            practice.practice.id,
            candidate.prepared.input.pack.name,
            source.pack_name,
          );
        }
      }
    }
  }

  private reconcileEffectivePractices(
    practiceIds: ReadonlySet<string>,
    candidates: ReadonlyMap<string, CandidatePractice>,
  ): boolean {
    let changed = false;
    for (const practiceId of practiceIds) {
      const existing = this.repository.effectivePractice(practiceId);
      const sources = this.repository.sourcesForPractice(practiceId);
      if (sources.length === 0) {
        if (existing !== null) {
          this.repository.deleteEffectivePractice(practiceId);
          changed = true;
        }
        continue;
      }

      const digest = sources[0]?.content_digest;
      if (digest === undefined) {
        throw new StoreInvariantError(`Practice "${practiceId}" has no readable source digest`);
      }
      if (sources.some((source) => source.content_digest !== digest)) {
        throw new StoreInvariantError(`Practice "${practiceId}" has conflicting source digests`);
      }
      if (existing?.contentDigest === digest) continue;

      const candidate = candidates.get(practiceId);
      if (candidate === undefined || candidate.contentDigest !== digest) {
        throw new StoreInvariantError(
          `Practice "${practiceId}" needs effective content absent from the candidate pack`,
        );
      }
      this.repository.saveEffectivePractice(
        candidate.practice,
        candidate.canonicalContent,
        candidate.contentDigest,
        existing?.effectiveRevision ?? 0,
      );
      changed = true;
    }
    return changed;
  }

  private rewriteChangedEffectiveRevisions(
    practiceIds: ReadonlySet<string>,
    effectiveRevision: number,
    candidates: ReadonlyMap<string, CandidatePractice> = new Map(),
  ): void {
    for (const practiceId of practiceIds) {
      const effective = this.repository.effectivePractice(practiceId);
      if (effective === null || effective.effectiveRevision === effectiveRevision) continue;
      const candidate = candidates.get(practiceId);
      if (candidate === undefined || candidate.contentDigest !== effective.contentDigest) continue;
      this.repository.saveEffectivePractice(
        candidate.practice,
        candidate.canonicalContent,
        candidate.contentDigest,
        effectiveRevision,
      );
    }
  }

  private nextManifest(packs: readonly InstalledPack[]): InstalledPacksManifest {
    return {
      ...emptyManifest(),
      generation: this.manifest.generation + 1,
      packs: [...packs].sort((left, right) => left.name.localeCompare(right.name)),
    };
  }
}
