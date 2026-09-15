import { and, eq, inArray } from "drizzle-orm";
import { access, mkdir, rm } from "node:fs/promises";

import { acquireMutationLock } from "../local-store/storage/mutation-lock";
import { openSqliteConnection } from "../persistence/database/connection";
import { migrateSqlite } from "../persistence/database/migrator";
import { semanticVectorCacheDatabaseDefinition } from "../persistence/definitions";
import { embeddingVectors } from "../persistence/schemas/semantic-vector-cache";
import type { EmbeddingProfile } from "../query/semantic/profile";
import type { SemanticDocument } from "../query/semantic/projection";
import { semanticVectorCachePaths } from "./cache";

const DIGEST = /^[a-f0-9]{64}$/;

function vectorBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function validVector(value: unknown, dimensions: number): Float32Array | undefined {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT
  ) {
    return undefined;
  }
  const copy = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  const vector = new Float32Array(copy);
  let squaredLength = 0;
  for (const coordinate of vector) {
    if (!Number.isFinite(coordinate)) return undefined;
    squaredLength += coordinate * coordinate;
  }
  return Math.abs(Math.sqrt(squaredLength) - 1) < 0.001 ? vector : undefined;
}

function validDocument(document: SemanticDocument): boolean {
  return DIGEST.test(document.projectionDigest);
}

async function databaseExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withWriter<T>(cacheRoot: string, work: () => Promise<T>): Promise<T> {
  const paths = semanticVectorCachePaths(cacheRoot);
  await mkdir(paths.writer, { recursive: true });
  const lock = await acquireMutationLock(paths.writer);
  try {
    return await work();
  } finally {
    await lock.release();
  }
}

/**
 * Read compatible vectors by semantic projection. Corrupt entries are cache
 * misses: the current target can safely embed again without trusting them.
 */
export async function readSharedEmbeddingVectors(
  cacheRoot: string,
  profile: EmbeddingProfile,
  documents: readonly SemanticDocument[],
): Promise<ReadonlyMap<string, Float32Array>> {
  const paths = semanticVectorCachePaths(cacheRoot);
  if (!(await databaseExists(paths.database)) || documents.length === 0) return new Map();
  const digests = [
    ...new Set(documents.filter(validDocument).map((item) => item.projectionDigest)),
  ];
  if (digests.length === 0) return new Map();
  try {
    return await withWriter(cacheRoot, async () => {
      const connection = openSqliteConnection(
        paths.database,
        semanticVectorCacheDatabaseDefinition.schema,
      );
      try {
        migrateSqlite(connection, semanticVectorCacheDatabaseDefinition);
        const rows = connection.orm
          .select({
            projectionDigest: embeddingVectors.projectionDigest,
            encodingId: embeddingVectors.encodingId,
            dimensions: embeddingVectors.dimensions,
            normalization: embeddingVectors.normalization,
            vector: embeddingVectors.vector,
          })
          .from(embeddingVectors)
          .where(
            and(
              eq(embeddingVectors.profileId, profile.profileId),
              inArray(embeddingVectors.projectionDigest, digests),
            ),
          )
          .all();
        const values = new Map<string, Float32Array>();
        for (const row of rows) {
          if (
            !DIGEST.test(row.projectionDigest) ||
            row.encodingId !== profile.encodingId ||
            row.dimensions !== profile.dimensions ||
            row.normalization !== "l2"
          ) {
            continue;
          }
          const vector = validVector(row.vector, profile.dimensions);
          if (vector !== undefined) values.set(row.projectionDigest, vector);
        }
        if (values.size > 0) {
          connection.orm
            .update(embeddingVectors)
            .set({ lastAccessedAt: new Date().toISOString() })
            .where(
              and(
                eq(embeddingVectors.profileId, profile.profileId),
                inArray(embeddingVectors.projectionDigest, [...values.keys()]),
              ),
            )
            .run();
        }
        return values;
      } finally {
        connection.close();
      }
    });
  } catch {
    // The vector cache is an optimization. An inaccessible or damaged cache
    // must never turn a current Practice query into a false answer or a manual
    // cleanup task; the caller will embed the compatible misses.
    return new Map();
  }
}

/** Persist validated new vectors before their progress rows can claim readiness. */
export async function writeSharedEmbeddingVectors(
  cacheRoot: string,
  profile: EmbeddingProfile,
  documents: readonly SemanticDocument[],
  vectors: readonly Float32Array[],
): Promise<void> {
  if (documents.length !== vectors.length || documents.length === 0) return;
  const paths = semanticVectorCachePaths(cacheRoot);
  try {
    await withWriter(cacheRoot, async () => {
      await mkdir(paths.directory, { recursive: true });
      const connection = openSqliteConnection(
        paths.database,
        semanticVectorCacheDatabaseDefinition.schema,
      );
      try {
        migrateSqlite(connection, semanticVectorCacheDatabaseDefinition);
        const timestamp = new Date().toISOString();
        connection.orm.transaction(() => {
          for (const [index, document] of documents.entries()) {
            if (!validDocument(document)) continue;
            const vector = validVector(vectorBlob(vectors[index]!), profile.dimensions);
            if (vector === undefined) continue;
            connection.orm
              .insert(embeddingVectors)
              .values({
                profileId: profile.profileId,
                projectionDigest: document.projectionDigest,
                encodingId: profile.encodingId,
                dimensions: profile.dimensions,
                normalization: "l2",
                vector: vectorBlob(vector),
                createdAt: timestamp,
                lastAccessedAt: timestamp,
              })
              .onConflictDoUpdate({
                target: [embeddingVectors.profileId, embeddingVectors.projectionDigest],
                set: {
                  encodingId: profile.encodingId,
                  dimensions: profile.dimensions,
                  normalization: "l2",
                  vector: vectorBlob(vector),
                  lastAccessedAt: timestamp,
                },
              })
              .run();
          }
        });
      } finally {
        connection.close();
      }
    });
  } catch {
    // A durable vector cache is helpful but not canonical. Progress still
    // publishes its own verified row in the same target build.
  }
}

export interface SharedVectorCacheStatus {
  readonly vectorCount: number;
  readonly byteSize: number;
}

export async function sharedVectorCacheStatus(cacheRoot: string): Promise<SharedVectorCacheStatus> {
  const paths = semanticVectorCachePaths(cacheRoot);
  if (!(await databaseExists(paths.database))) return { vectorCount: 0, byteSize: 0 };
  try {
    const connection = openSqliteConnection(
      paths.database,
      semanticVectorCacheDatabaseDefinition.schema,
      {
        readonly: true,
      },
    );
    try {
      const rows = connection.orm.select().from(embeddingVectors).all();
      const info = await Bun.file(paths.database).stat();
      return { vectorCount: rows.length, byteSize: info.size };
    } finally {
      connection.close();
    }
  } catch {
    return { vectorCount: 0, byteSize: 0 };
  }
}

/** An explicit prune may discard every reusable vector; all entries are derived state. */
export async function pruneSharedVectorCache(cacheRoot: string): Promise<number> {
  const paths = semanticVectorCachePaths(cacheRoot);
  if (!(await databaseExists(paths.database))) return 0;
  return withWriter(cacheRoot, async () => {
    const info = await Bun.file(paths.database)
      .stat()
      .catch(() => undefined);
    await Promise.all([
      rm(paths.database, { force: true }),
      rm(`${paths.database}-wal`, { force: true }),
      rm(`${paths.database}-shm`, { force: true }),
    ]);
    return info?.size ?? 0;
  });
}
