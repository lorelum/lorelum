import { InvalidPracticeSourceError, PracticeConflictError } from "./errors";
import { isPracticeSourcePath } from "./candidate";
import { canonicalizePractice } from "./canonical-practice";
import type {
  EffectivePractice,
  PackCandidate,
  PracticeSource,
  ReconciledPractices,
  RevisionDelta,
} from "./types";

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(left: PracticeSource, right: PracticeSource): number {
  return (
    compareCodeUnits(left.packName, right.packName) ||
    compareCodeUnits(left.sourcePath, right.sourcePath)
  );
}

/**
 * Fully re-canonicalize a source before trusting it. This is deliberate
 * defense-in-depth: at this stage sources may come from an untrusted caller
 * (snapshot decode, cold open, recovery), so the stored digest and canonical
 * content are re-derived and compared rather than assumed consistent.
 * `createPackCandidate` already validated sources at build time; this second
 * pass guards the merge boundary itself. The cost is O(canonicalization) per
 * source — negligible at P1/P2 scale; if a future lifecycle layer can prove
 * sources were validated at a trusted boundary, this can be relaxed to the
 * cheap id/digest/path checks below.
 */
function assertValidSource(source: PracticeSource, expectedPackName?: string): void {
  if (expectedPackName !== undefined && source.packName !== expectedPackName) {
    throw new InvalidPracticeSourceError(source.practiceId, "pack name differs from its candidate");
  }
  if (source.practiceId !== source.canonicalPractice.practice.id) {
    throw new InvalidPracticeSourceError(
      source.practiceId,
      "practice id differs from canonical snapshot",
    );
  }
  if (!isPracticeSourcePath(source.sourcePath)) {
    throw new InvalidPracticeSourceError(
      source.practiceId,
      "source path is not a normalized Practice path",
    );
  }
  const canonical = canonicalizePractice(source.canonicalPractice.practice);
  if (
    source.contentDigest !== canonical.contentDigest ||
    source.canonicalPractice.contentDigest !== canonical.contentDigest ||
    source.canonicalPractice.canonicalContent !== canonical.canonicalContent
  ) {
    throw new InvalidPracticeSourceError(source.practiceId, "canonical content or digest mismatch");
  }
}

function buildEffectivePractices(sources: readonly PracticeSource[]): readonly EffectivePractice[] {
  const byPracticeId = new Map<string, PracticeSource[]>();
  for (const source of sources) {
    assertValidSource(source);
    const group = byPracticeId.get(source.practiceId);
    if (group === undefined) byPracticeId.set(source.practiceId, [source]);
    else group.push(source);
  }

  const effectivePractices: EffectivePractice[] = [];
  for (const [practiceId, group] of byPracticeId) {
    const orderedSources = [...group].sort(compareSources);
    const primary = orderedSources[0];
    if (primary === undefined) continue;
    for (const source of orderedSources.slice(1)) {
      if (source.contentDigest !== primary.contentDigest) {
        throw new PracticeConflictError(practiceId, source.packName, primary.packName);
      }
    }
    effectivePractices.push(
      Object.freeze({
        practiceId,
        contentDigest: primary.contentDigest,
        canonicalContent: primary.canonicalPractice.canonicalContent,
        practice: primary.canonicalPractice.practice,
        sources: Object.freeze(orderedSources),
      }),
    );
  }
  return [...effectivePractices].sort((left, right) =>
    compareCodeUnits(left.practiceId, right.practiceId),
  );
}

function effectiveDigestMap(practices: readonly EffectivePractice[]): Map<string, string> {
  return new Map(practices.map((practice) => [practice.practiceId, practice.contentDigest]));
}

function calculateDelta(
  previous: readonly EffectivePractice[],
  next: readonly EffectivePractice[],
): RevisionDelta {
  const previousDigests = effectiveDigestMap(previous);
  const nextDigests = effectiveDigestMap(next);
  const added: string[] = [];
  const changed: string[] = [];
  const invalidated: string[] = [];

  for (const [practiceId, digest] of nextDigests) {
    const previousDigest = previousDigests.get(practiceId);
    if (previousDigest === undefined) added.push(practiceId);
    else if (previousDigest !== digest) changed.push(practiceId);
  }
  for (const practiceId of previousDigests.keys()) {
    if (!nextDigests.has(practiceId)) invalidated.push(practiceId);
  }
  return Object.freeze({
    added: Object.freeze([...added].sort(compareCodeUnits)),
    changed: Object.freeze([...changed].sort(compareCodeUnits)),
    invalidated: Object.freeze([...invalidated].sort(compareCodeUnits)),
  });
}

/**
 * Reconcile one candidate into the complete active source set. Set
 * `replacePackName` for an upgrade, which removes that Pack's old sources
 * before conflict checking the candidate's complete replacement snapshot.
 */
export function reconcileEffectivePractices(
  existingSources: readonly PracticeSource[],
  candidate: PackCandidate,
  replacePackName?: string,
): ReconciledPractices {
  if (replacePackName !== undefined && replacePackName !== candidate.pack.name) {
    throw new InvalidPracticeSourceError(
      candidate.pack.name,
      "replacement pack name differs from candidate pack name",
    );
  }
  for (const source of candidate.sources) assertValidSource(source, candidate.pack.name);
  const previous = buildEffectivePractices(existingSources);
  const retainedSources = existingSources.filter((source) => source.packName !== replacePackName);
  for (const source of candidate.sources) {
    const conflict = retainedSources.find(
      (retained) =>
        retained.practiceId === source.practiceId &&
        retained.contentDigest !== source.contentDigest,
    );
    if (conflict !== undefined) {
      throw new PracticeConflictError(source.practiceId, candidate.pack.name, conflict.packName);
    }
  }
  const sources = [...retainedSources, ...candidate.sources].sort(compareSources);
  const effectivePractices = buildEffectivePractices(sources);
  const delta = calculateDelta(previous, effectivePractices);
  return Object.freeze({
    sources: Object.freeze(sources),
    effectivePractices: Object.freeze(effectivePractices),
    delta,
    advancesEffectiveRevision:
      delta.added.length > 0 || delta.changed.length > 0 || delta.invalidated.length > 0,
  });
}

/** Rebuild the Effective Practice view after removing all sources of one Pack. */
export function removePackSources(
  existingSources: readonly PracticeSource[],
  packName: string,
): ReconciledPractices {
  const previous = buildEffectivePractices(existingSources);
  const sources = existingSources
    .filter((source) => source.packName !== packName)
    .sort(compareSources);
  const effectivePractices = buildEffectivePractices(sources);
  const delta = calculateDelta(previous, effectivePractices);
  return Object.freeze({
    sources: Object.freeze(sources),
    effectivePractices: Object.freeze(effectivePractices),
    delta,
    advancesEffectiveRevision:
      delta.added.length > 0 || delta.changed.length > 0 || delta.invalidated.length > 0,
  });
}
