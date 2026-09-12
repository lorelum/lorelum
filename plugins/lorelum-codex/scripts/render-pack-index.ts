import type { InstalledPackSummary } from "./types";

// Headroom below the hooks.json `additionalContextLimit` (5000) so the frozen
// envelope fields never push the delivered context over the host budget.
export const DEFAULT_MAX_CHARACTERS = 4_000;

export interface RenderPackIndexOptions {
  readonly maxCharacters?: number;
}

/** Replace control characters with spaces and collapse whitespace runs. */
function normalizeText(value: string): string {
  return value
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f ? character : " ";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function comparePacks(left: InstalledPackSummary, right: InstalledPackSummary): number {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  return left.version < right.version ? -1 : left.version > right.version ? 1 : 0;
}

function renderPack(pack: InstalledPackSummary): string {
  const lines = [`- ${normalizeText(pack.name)} (${normalizeText(pack.version)})`];
  const appliesTo = pack.appliesTo.map(normalizeText).filter(Boolean);
  if (appliesTo.length > 0) lines.push(`  Covers: ${appliesTo.join(", ")}`);
  if (pack.description !== undefined) {
    const description = normalizeText(pack.description);
    if (description !== "") lines.push(`  Description: ${description}`);
  }
  return lines.join("\n");
}

function truncate(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text;
  const suffix = "\n[Pack Index truncated]";
  const available = Math.max(0, maxCharacters - suffix.length);
  return text.slice(0, available).trimEnd() + suffix;
}

export function renderPackIndex(
  packs: readonly InstalledPackSummary[],
  options: RenderPackIndexOptions = {},
): string {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 64) {
    throw new RangeError("Pack Index character budget must be an integer of at least 64.");
  }

  // The manifest guarantees unique active Pack names; keep the first entry in
  // case a host delivers a duplicated list anyway.
  const uniquePacks = new Map<string, InstalledPackSummary>();
  for (const pack of packs) {
    const name = normalizeText(pack.name);
    if (name !== "" && !uniquePacks.has(name)) {
      uniquePacks.set(name, {
        name,
        version: normalizeText(pack.version),
        ...(pack.description === undefined ? {} : { description: normalizeText(pack.description) }),
        appliesTo: Object.freeze(pack.appliesTo.map(normalizeText).filter(Boolean)),
      });
    }
  }

  const sortedPacks = [...uniquePacks.values()].sort(comparePacks);
  const body =
    sortedPacks.length === 0
      ? "No installed Knowledge Packs are currently available."
      : sortedPacks.map(renderPack).join("\n");
  return truncate(
    [
      "Lorelum Pack Index",
      "",
      body,
      "",
      "Use this index only to decide whether Lorelum may be relevant. Query Practices only for a matching task and work moment; do not query before every action.",
    ].join("\n"),
    maxCharacters,
  );
}
