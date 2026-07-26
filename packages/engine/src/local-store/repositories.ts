import type { Database } from "bun:sqlite";

import type { AntiPattern, Practice } from "@lorelum/format";

import type { InstalledPack, EffectivePractice, LocalStoreState } from "./types";

interface SourceRow {
  readonly pack_name: string;
  readonly practice_id: string;
  readonly content_digest: string;
  readonly source_path: string;
}

interface EffectivePracticeRow {
  readonly practice_id: string;
  readonly content_digest: string;
  readonly canonical_content: string;
  readonly title: string;
  readonly stage: string;
  readonly tech_stack_json: string;
  readonly applies_when: string;
  readonly severity: NonNullable<Practice["severity"]>;
  readonly body: string;
  readonly anti_patterns_json: string;
  readonly effective_revision: number;
}

interface ActivePackRow {
  readonly pack_name: string;
  readonly pack_version: string;
  readonly artifact_digest: string;
  readonly storage_key: string;
  readonly installed_at: string;
}

export class LocalStoreRepository {
  constructor(private readonly database: Database) {}

  state(): LocalStoreState {
    return {
      installedPacksGeneration: this.metadataNumber("installed_packs_generation"),
      effectiveRevision: this.metadataNumber("effective_revision"),
    };
  }

  installedPack(name: string): InstalledPack | null {
    const row = this.database
      .query<ActivePackRow, [string]>(
        `SELECT pack_name, pack_version, artifact_digest, storage_key, installed_at
         FROM active_packs WHERE pack_name = ?`,
      )
      .get(name);
    return row === null ? null : toInstalledPack(row);
  }

  allInstalledPacks(): readonly InstalledPack[] {
    return this.database
      .query<ActivePackRow, []>(
        `SELECT pack_name, pack_version, artifact_digest, storage_key, installed_at
         FROM active_packs ORDER BY pack_name`,
      )
      .all()
      .map(toInstalledPack);
  }

  sourcesForPractice(practiceId: string): readonly SourceRow[] {
    return this.database
      .query<SourceRow, [string]>(
        `SELECT pack_name, practice_id, content_digest, source_path
         FROM practice_sources WHERE practice_id = ? ORDER BY pack_name`,
      )
      .all(practiceId);
  }

  sourcesForPack(packName: string): readonly SourceRow[] {
    return this.database
      .query<SourceRow, [string]>(
        `SELECT pack_name, practice_id, content_digest, source_path
         FROM practice_sources WHERE pack_name = ? ORDER BY practice_id`,
      )
      .all(packName);
  }

  effectivePractice(practiceId: string): EffectivePractice | null {
    const row = this.database
      .query<EffectivePracticeRow, [string]>(
        `SELECT practice_id, content_digest, canonical_content, title, stage, tech_stack_json,
                applies_when, severity, body, anti_patterns_json, effective_revision
         FROM effective_practices WHERE practice_id = ?`,
      )
      .get(practiceId);
    return row === null ? null : this.toEffectivePractice(row);
  }

  allEffectivePractices(): readonly EffectivePractice[] {
    return this.database
      .query<EffectivePracticeRow, []>(
        `SELECT practice_id, content_digest, canonical_content, title, stage, tech_stack_json,
                applies_when, severity, body, anti_patterns_json, effective_revision
         FROM effective_practices ORDER BY practice_id`,
      )
      .all()
      .map((row) => this.toEffectivePractice(row));
  }

  deletePack(packName: string): void {
    this.database
      .query<unknown, [string]>("DELETE FROM active_packs WHERE pack_name = ?")
      .run(packName);
  }

  savePack(pack: InstalledPack): void {
    this.database
      .query<unknown, [string, string, string, string, string]>(
        `INSERT INTO active_packs(pack_name, pack_version, artifact_digest, storage_key, installed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(pack_name) DO UPDATE SET
           pack_version = excluded.pack_version,
           artifact_digest = excluded.artifact_digest,
           storage_key = excluded.storage_key,
           installed_at = excluded.installed_at`,
      )
      .run(pack.name, pack.version, pack.artifactDigest, pack.storageKey, pack.installedAt);
  }

  addSource(packName: string, practiceId: string, contentDigest: string, sourcePath: string): void {
    this.database
      .query<unknown, [string, string, string, string]>(
        `INSERT INTO practice_sources(pack_name, practice_id, content_digest, source_path)
         VALUES (?, ?, ?, ?)`,
      )
      .run(packName, practiceId, contentDigest, sourcePath);
  }

  deleteSourcesForPack(packName: string): void {
    this.database
      .query<unknown, [string]>("DELETE FROM practice_sources WHERE pack_name = ?")
      .run(packName);
  }

  saveEffectivePractice(
    practice: Practice,
    canonicalContent: string,
    contentDigest: string,
    effectiveRevision: number,
  ): void {
    this.database
      .query<
        unknown,
        [string, string, string, string, string, string, string, string, string, string, number]
      >(
        `INSERT INTO effective_practices(
           practice_id, content_digest, canonical_content, title, stage, tech_stack_json,
           applies_when, severity, body, anti_patterns_json, effective_revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(practice_id) DO UPDATE SET
           content_digest = excluded.content_digest,
           canonical_content = excluded.canonical_content,
           title = excluded.title,
           stage = excluded.stage,
           tech_stack_json = excluded.tech_stack_json,
           applies_when = excluded.applies_when,
           severity = excluded.severity,
           body = excluded.body,
           anti_patterns_json = excluded.anti_patterns_json,
           effective_revision = excluded.effective_revision`,
      )
      .run(
        practice.id,
        contentDigest,
        canonicalContent,
        practice.title,
        practice.stage,
        JSON.stringify(practice.tech_stack),
        practice.applies_when,
        practice.severity ?? "warn",
        practice.body ?? "",
        JSON.stringify(practice.anti_patterns ?? []),
        effectiveRevision,
      );
  }

  deleteEffectivePractice(practiceId: string): void {
    this.database
      .query<unknown, [string]>("DELETE FROM effective_practices WHERE practice_id = ?")
      .run(practiceId);
  }

  setState(state: LocalStoreState): void {
    this.setMetadata("installed_packs_generation", String(state.installedPacksGeneration));
    this.setMetadata("effective_revision", String(state.effectiveRevision));
  }

  private toEffectivePractice(row: EffectivePracticeRow): EffectivePractice {
    const sourcePackNames = this.sourcesForPractice(row.practice_id).map(
      (source) => source.pack_name,
    );
    return {
      id: row.practice_id,
      title: row.title,
      stage: row.stage,
      techStack: JSON.parse(row.tech_stack_json) as string[],
      appliesWhen: row.applies_when,
      severity: row.severity,
      body: row.body,
      antiPatterns: JSON.parse(row.anti_patterns_json) as AntiPattern[],
      canonicalContent: row.canonical_content,
      contentDigest: row.content_digest,
      effectiveRevision: row.effective_revision,
      sourcePackNames,
    };
  }

  private metadataNumber(key: string): number {
    const row = this.database
      .query<{ value: string }, [string]>("SELECT value FROM store_metadata WHERE key = ?")
      .get(key);
    return Number(row?.value ?? "0");
  }

  private setMetadata(key: string, value: string): void {
    this.database
      .query<unknown, [string, string]>(
        `INSERT INTO store_metadata(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}

function toInstalledPack(row: ActivePackRow): InstalledPack {
  return {
    name: row.pack_name,
    version: row.pack_version,
    artifactDigest: row.artifact_digest,
    storageKey: row.storage_key,
    installedAt: row.installed_at,
  };
}
