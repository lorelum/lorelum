import { inArray } from "drizzle-orm";
import { access, mkdir, stat } from "node:fs/promises";
import { relative } from "node:path";

import { acquireMutationLock } from "../local-store/storage/mutation-lock";
import { openSqliteConnection } from "../persistence/database/connection";
import { migrateSqlite } from "../persistence/database/migrator";
import { projectCacheDatabaseDefinition } from "../persistence/definitions";
import {
  projectContextArtifactIndexes,
  projectContextArtifacts,
} from "../persistence/schemas/project-cache";
import { projectCachePaths } from "./cache";

const DIGEST = /^[a-f0-9]{64}$/;

export type ProjectCacheArtifactKind = "keyword" | "semantic";
export type ProjectCacheArtifactState = "ready" | "progress";

export interface ProjectCacheArtifactRecord {
  readonly artifactId: string;
  readonly kind: ProjectCacheArtifactKind;
  readonly profileId?: string;
  readonly corpusDigest: string;
  readonly documentCount: number;
  readonly state: ProjectCacheArtifactState;
  /** Must point at a generated cache file, never a source file. */
  readonly filePath: string;
  readonly verified: boolean;
}

export interface ProjectCacheCatalogStatus {
  readonly artifactCount: number;
  readonly keywordArtifactCount: number;
  readonly semanticArtifactCount: number;
}

function validRecord(record: ProjectCacheArtifactRecord): boolean {
  return (
    DIGEST.test(record.artifactId) &&
    DIGEST.test(record.corpusDigest) &&
    (record.profileId === undefined || DIGEST.test(record.profileId)) &&
    Number.isSafeInteger(record.documentCount) &&
    record.documentCount >= 0
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withCatalogWriter<T>(cacheRoot: string, work: () => Promise<T>): Promise<T> {
  const paths = projectCachePaths(cacheRoot);
  await mkdir(paths.catalogWriter, { recursive: true });
  const lock = await acquireMutationLock(paths.catalogWriter);
  try {
    return await work();
  } finally {
    await lock.release();
  }
}

function safeRelativeArtifactPath(cacheRoot: string, filePath: string): string | undefined {
  const prefix = projectCachePaths(cacheRoot).artifacts;
  const path = relative(prefix, filePath).replaceAll("\\", "/");
  if (
    !/^(keyword|semantic)\/[a-f0-9]{64}\/(active|progress)\.sqlite$/.test(path) ||
    path.startsWith("../")
  ) {
    return undefined;
  }
  return path;
}

/** Best-effort catalog write. A failure never invalidates an already verified artifact. */
export async function recordProjectCacheArtifact(
  cacheRoot: string,
  record: ProjectCacheArtifactRecord,
): Promise<void> {
  if (!validRecord(record) || !(await exists(record.filePath))) return;
  const relativePath = safeRelativeArtifactPath(cacheRoot, record.filePath);
  if (relativePath === undefined) return;
  let fileSize: number;
  try {
    fileSize = (await stat(record.filePath)).size;
  } catch {
    return;
  }
  try {
    await withCatalogWriter(cacheRoot, async () => {
      const paths = projectCachePaths(cacheRoot);
      await mkdir(paths.directory, { recursive: true });
      const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema);
      try {
        migrateSqlite(connection, projectCacheDatabaseDefinition);
        const timestamp = new Date().toISOString();
        connection.orm.transaction(() => {
          connection.orm
            .insert(projectContextArtifacts)
            .values({
              artifactId: record.artifactId,
              kind: record.kind,
              ...(record.profileId === undefined ? {} : { profileId: record.profileId }),
              corpusDigest: record.corpusDigest,
              documentCount: record.documentCount,
              createdAt: timestamp,
              lastAccessedAt: timestamp,
            })
            .onConflictDoUpdate({
              target: projectContextArtifacts.artifactId,
              set: {
                kind: record.kind,
                ...(record.profileId === undefined
                  ? { profileId: null }
                  : { profileId: record.profileId }),
                corpusDigest: record.corpusDigest,
                documentCount: record.documentCount,
                lastAccessedAt: timestamp,
              },
            })
            .run();
          connection.orm
            .insert(projectContextArtifactIndexes)
            .values({
              artifactId: record.artifactId,
              state: record.state,
              relativePath,
              byteSize: fileSize,
              publishedAt: timestamp,
              ...(record.verified ? { verifiedAt: timestamp } : {}),
            })
            .onConflictDoUpdate({
              target: [
                projectContextArtifactIndexes.artifactId,
                projectContextArtifactIndexes.state,
              ],
              set: {
                relativePath,
                byteSize: fileSize,
                publishedAt: timestamp,
                ...(record.verified ? { verifiedAt: timestamp } : { verifiedAt: null }),
              },
            })
            .run();
        });
      } finally {
        connection.close();
      }
    });
  } catch {
    // The artifact remains usable and its next access can repopulate the
    // advisory catalog. Never fail a current query because bookkeeping lost a race.
  }
}

export async function removeProjectCacheArtifactRecords(
  cacheRoot: string,
  artifactIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(artifactIds.filter((id) => DIGEST.test(id)))];
  if (ids.length === 0) return;
  const paths = projectCachePaths(cacheRoot);
  if (!(await exists(paths.catalog))) return;
  try {
    await withCatalogWriter(cacheRoot, async () => {
      const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema);
      try {
        migrateSqlite(connection, projectCacheDatabaseDefinition);
        connection.orm
          .delete(projectContextArtifacts)
          .where(inArray(projectContextArtifacts.artifactId, ids))
          .run();
      } finally {
        connection.close();
      }
    });
  } catch {
    // Leftover metadata is harmless and will be reconciled by the next record.
  }
}

export async function projectCacheCatalogStatus(
  cacheRoot: string,
): Promise<ProjectCacheCatalogStatus> {
  const paths = projectCachePaths(cacheRoot);
  if (!(await exists(paths.catalog))) {
    return { artifactCount: 0, keywordArtifactCount: 0, semanticArtifactCount: 0 };
  }
  try {
    const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema, {
      readonly: true,
    });
    try {
      const rows = connection.orm
        .select({ kind: projectContextArtifacts.kind })
        .from(projectContextArtifacts)
        .all();
      return {
        artifactCount: rows.length,
        keywordArtifactCount: rows.filter((row) => row.kind === "keyword").length,
        semanticArtifactCount: rows.filter((row) => row.kind === "semantic").length,
      };
    } finally {
      connection.close();
    }
  } catch {
    return { artifactCount: 0, keywordArtifactCount: 0, semanticArtifactCount: 0 };
  }
}
