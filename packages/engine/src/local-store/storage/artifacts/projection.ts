import { PackSchema, PracticeSchema } from "@lorelum/format";

import {
  canonicalizePractice,
  deepFreeze,
  isPracticeSourcePath,
  type PackSnapshot,
  type PracticeSource,
} from "../../model";

import { ArtifactIntegrityError } from "../errors";

export const PROJECTION_RELATIVE_PATH = ".lorelum/local-store-projection.json";
export const PROJECTION_VERSION = 1;

export interface SnapshotProjection {
  projectionVersion: number;
  pack: PackSnapshot;
  practices: readonly ProjectionPractice[];
}

export interface ProjectionPractice {
  id: string;
  contentDigest: string;
  canonicalContent: string;
  sourcePath: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createProjection(
  pack: PackSnapshot,
  sources: readonly PracticeSource[],
): SnapshotProjection {
  return Object.freeze({
    projectionVersion: PROJECTION_VERSION,
    pack,
    practices: Object.freeze(
      sources
        .map((source) =>
          Object.freeze({
            id: source.practiceId,
            contentDigest: source.contentDigest,
            canonicalContent: source.canonicalPractice.canonicalContent,
            sourcePath: source.sourcePath,
          }),
        )
        .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath)),
    ),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode generated JSON without trusting arbitrary projection shapes. */
export function parseProjection(text: string, artifactPath: string): SnapshotProjection {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ArtifactIntegrityError(artifactPath, "projection is not valid JSON");
  }
  if (!isRecord(value) || value.projectionVersion !== PROJECTION_VERSION || !isRecord(value.pack)) {
    throw new ArtifactIntegrityError(artifactPath, "projection has an unsupported shape");
  }
  if (!Array.isArray(value.practices)) {
    throw new ArtifactIntegrityError(artifactPath, "projection practices must be an array");
  }
  const pack = PackSchema.safeParse(value.pack);
  if (!pack.success)
    throw new ArtifactIntegrityError(artifactPath, "projection Pack metadata is invalid");
  const practiceIds = new Set<string>();
  const sourcePaths = new Set<string>();
  const practices: ProjectionPractice[] = value.practices.map((practice) => {
    if (
      !isRecord(practice) ||
      typeof practice.id !== "string" ||
      typeof practice.contentDigest !== "string" ||
      typeof practice.canonicalContent !== "string" ||
      typeof practice.sourcePath !== "string"
    ) {
      throw new ArtifactIntegrityError(
        artifactPath,
        "projection contains an invalid practice entry",
      );
    }
    let canonicalPractice: unknown;
    try {
      canonicalPractice = JSON.parse(practice.canonicalContent);
    } catch {
      throw new ArtifactIntegrityError(artifactPath, "projection canonical content is not JSON");
    }
    const parsedPractice = PracticeSchema.safeParse(canonicalPractice);
    if (!parsedPractice.success) {
      throw new ArtifactIntegrityError(
        artifactPath,
        "projection canonical content violates Practice schema",
      );
    }
    const canonical = canonicalizePractice(parsedPractice.data);
    if (
      canonical.canonicalContent !== practice.canonicalContent ||
      canonical.contentDigest !== practice.contentDigest ||
      canonical.practice.id !== practice.id ||
      !isPracticeSourcePath(practice.sourcePath) ||
      practiceIds.has(practice.id) ||
      sourcePaths.has(practice.sourcePath)
    ) {
      throw new ArtifactIntegrityError(artifactPath, "projection practice data is inconsistent");
    }
    practiceIds.add(practice.id);
    sourcePaths.add(practice.sourcePath);
    return Object.freeze({
      id: practice.id,
      contentDigest: practice.contentDigest,
      canonicalContent: practice.canonicalContent,
      sourcePath: practice.sourcePath,
    });
  });
  return Object.freeze({
    projectionVersion: PROJECTION_VERSION,
    pack: deepFreeze(structuredClone(pack.data)) as PackSnapshot,
    practices: Object.freeze(practices),
  });
}

export function serializeProjection(projection: SnapshotProjection): string {
  return JSON.stringify(projection) + "\n";
}
