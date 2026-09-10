import type { EffectivePractice } from "../local-store/index.js";
import type {
  ListedPack,
  ListedPractice,
  RetrievePackPracticesInput,
  RetrievePackPracticesResult,
  RetrievePacksInput,
  RetrievePacksResult,
} from "./types.js";

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function practiceCountsByPack(
  effectivePractices: readonly EffectivePractice[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const effectivePractice of effectivePractices) {
    const packNames = new Set(effectivePractice.sources.map((source) => source.packName));
    for (const packName of packNames) {
      counts.set(packName, (counts.get(packName) ?? 0) + 1);
    }
  }
  return counts;
}

function projectPractice(effectivePractice: EffectivePractice): ListedPractice {
  return Object.freeze({
    id: effectivePractice.practice.id,
    title: effectivePractice.practice.title,
    applies_when: effectivePractice.practice.applies_when,
  });
}

/** Project the active manifest into the `lore list` Pack catalog. */
export function retrievePacks(input: RetrievePacksInput): RetrievePacksResult {
  const counts = practiceCountsByPack(input.effectivePractices);
  const packs: readonly ListedPack[] = input.packs
    .map((pack) =>
      Object.freeze({
        name: pack.name,
        version: pack.version,
        practiceCount: counts.get(pack.name) ?? 0,
      }),
    )
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  return Object.freeze({ packs: Object.freeze(packs) });
}

/**
 * Project one installed Pack's Effective Practice source claims. Returns null
 * when the Pack is absent; the service boundary converts that to a typed error.
 */
export function retrievePackPractices(
  input: RetrievePackPracticesInput,
): RetrievePackPracticesResult | null {
  const pack = input.packs.find((candidate) => candidate.name === input.packName);
  if (pack === undefined) return null;

  const projectedPack = Object.freeze({ name: pack.name, version: pack.version });
  const practices = input.effectivePractices
    .filter((effectivePractice) =>
      effectivePractice.sources.some((source) => source.packName === pack.name),
    )
    .map(projectPractice)
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  return Object.freeze({ pack: projectedPack, practices: Object.freeze(practices) });
}
