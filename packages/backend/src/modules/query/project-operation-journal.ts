import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { BackendError } from "../../protocol/errors";
import { assertPrivateFile, checkDirectory, hasCode } from "../../runtime/runtime-state";

const MAX_JOURNAL_BYTES = 131_072;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const operationState = z.enum([
  "queued",
  "preparing",
  "building",
  "waiting-for-source",
  "superseded",
  "ready",
  "failed",
]);

const targetKind = z.enum(["project", "store"]);

export const semanticOperationRecordSchema = z.strictObject({
  operationId: z.string().uuid(),
  targetKind,
  /** Opaque project root or Store source identity; never an absolute path. */
  sourceId: digest,
  /** Opaque source/profile/cache-scope coalescing key. */
  targetSlotId: digest,
  /** Opaque cache-root scope; artifact IDs themselves remain content-addressed. */
  cacheScopeId: digest,
  artifactId: digest,
  corpusDigest: digest,
  profileId: digest,
  state: operationState,
  preparationId: z.string().uuid().optional(),
  indexedPracticeCount: z.int().nonnegative(),
  totalPracticeCount: z.int().nonnegative(),
  attempts: z.int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SemanticOperationRecord = z.infer<typeof semanticOperationRecordSchema>;

const journalSchema = z
  .strictObject({ operations: z.array(semanticOperationRecordSchema).max(128) })
  .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_JOURNAL_BYTES);

function pathFor(runtimeDirectory: string): string {
  return join(runtimeDirectory, "semantic-index-operations.json");
}

/**
 * Backend-private operation metadata for Store and ProjectContext targets. It
 * holds opaque digests and counters, never a path, Practice body, provenance,
 * or credentials.
 */
export class SemanticOperationJournal {
  constructor(private readonly runtimeDirectory: string) {}

  private async read(): Promise<readonly SemanticOperationRecord[]> {
    if (!(await checkDirectory(this.runtimeDirectory, true))) return [];
    const path = pathFor(this.runtimeDirectory);
    if (!(await assertPrivateFile(path))) return [];
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      (error: unknown) => {
        if (hasCode(error, "ENOENT")) return undefined;
        throw new BackendError("backend.state-invalid", { cause: error });
      },
    );
    if (file === undefined) return [];
    try {
      const info = await file.stat();
      if (info.size > MAX_JOURNAL_BYTES) throw new BackendError("backend.state-invalid");
      const parsed = journalSchema.safeParse(JSON.parse(await file.readFile("utf8")));
      if (!parsed.success) throw new BackendError("backend.state-invalid");
      return parsed.data.operations;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError("backend.state-invalid", { cause: error });
    } finally {
      await file.close();
    }
  }

  private async write(operations: readonly SemanticOperationRecord[]): Promise<void> {
    await checkDirectory(this.runtimeDirectory, true);
    const serialized = JSON.stringify({ operations });
    if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_BYTES) {
      throw new BackendError("backend.state-invalid");
    }
    const temporary = join(this.runtimeDirectory, `project-index-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(serialized);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, pathFor(this.runtimeDirectory));
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  /** Convert interrupted nonterminal work to safe source-reattachment state. */
  async recover(): Promise<readonly SemanticOperationRecord[]> {
    const current = await this.read();
    const timestamp = new Date().toISOString();
    const recovered = current.map((operation) =>
      operation.state === "queued" ||
      operation.state === "preparing" ||
      operation.state === "building"
        ? { ...operation, state: "waiting-for-source" as const, updatedAt: timestamp }
        : operation,
    );
    if (JSON.stringify(recovered) !== JSON.stringify(current)) await this.write(recovered);
    return recovered;
  }

  async findByTarget(
    artifactId: string,
    cacheScopeId: string,
  ): Promise<SemanticOperationRecord | undefined> {
    return (await this.read())
      .filter(
        (operation) =>
          operation.artifactId === artifactId && operation.cacheScopeId === cacheScopeId,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async findById(operationId: string): Promise<SemanticOperationRecord | undefined> {
    return (await this.read()).find((operation) => operation.operationId === operationId);
  }

  async latestForSlot(targetSlotId: string): Promise<SemanticOperationRecord | undefined> {
    return (await this.read())
      .filter((operation) => operation.targetSlotId === targetSlotId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async upsert(record: SemanticOperationRecord): Promise<void> {
    const current = await this.read();
    const index = current.findIndex((item) => item.operationId === record.operationId);
    const next = [...current];
    if (index === -1) next.push(record);
    else next[index] = record;
    // Keep bounded terminal provenance for operation lookup while making room
    // for current work. Oldest terminal entries are safe to forget.
    const trimmed = next
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(-128);
    await this.write(trimmed);
  }
}
