export interface InstalledPackCatalogEntry {
  readonly name: string;
  readonly description?: string;
  readonly appliesTo: readonly string[];
}

// Headroom below the hooks.json `additionalContextLimit` (5000) so the frozen
// envelope fields never push the delivered context over the host budget.
export const DEFAULT_MAX_CHARACTERS = 4_000;

const CATALOG_HEADER = "Lorelum Installed Pack Catalog";
const CATALOG_INTRO = "This compact catalog is a relevance hint, not complete guidance.";
const CATALOG_FOOTER =
  "For a matching task or decision, use the Lorelum Skill to retrieve detailed Practices. Do not infer that a Pack is irrelevant from missing description or stack scope.";
const TRUNCATION_NOTE =
  "Catalog entries truncated. Other Packs may still be installed; run `lore pack list --details` to refresh when needed.";
const MINIMAL_TRUNCATION_CONTEXT =
  "Lorelum catalog truncated. Run `lore pack list --details` to refresh when needed.";

export interface RenderPackCatalogOptions {
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

function comparePacks(left: InstalledPackCatalogEntry, right: InstalledPackCatalogEntry): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function renderPack(pack: InstalledPackCatalogEntry, includeSummary = true): string {
  const lines = [`- ${normalizeText(pack.name)}`];
  if (includeSummary) {
    const appliesTo = pack.appliesTo.map(normalizeText).filter(Boolean);
    if (appliesTo.length > 0) lines.push(`  Stack scope: ${appliesTo.join(", ")}`);
    if (pack.description !== undefined) {
      const description = normalizeText(pack.description);
      if (description !== "") lines.push(`  Description: ${description}`);
    }
  }
  return lines.join("\n");
}

function truncate(text: string, maxCharacters: number, suffix: string): string {
  if (text.length <= maxCharacters) return text;
  const available = Math.max(0, maxCharacters - suffix.length);
  return text.slice(0, available).trimEnd() + suffix;
}

function renderContext(body: string, truncationNote?: string): string {
  return [CATALOG_HEADER, CATALOG_INTRO, body, truncationNote, CATALOG_FOOTER]
    .filter((section): section is string => section !== undefined && section !== "")
    .join("\n\n");
}

/** Render the bounded Catalog context consumed by the Codex Hook ABI. */
export function renderPackCatalog(
  packs: readonly InstalledPackCatalogEntry[],
  options: RenderPackCatalogOptions = {},
): string {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 64) {
    throw new RangeError("Pack Catalog character budget must be an integer of at least 64.");
  }

  // The manifest guarantees unique active Pack names; keep the first entry in
  // case a Store ever delivers a duplicated list anyway.
  const uniquePacks = new Map<string, InstalledPackCatalogEntry>();
  for (const pack of packs) {
    const name = normalizeText(pack.name);
    if (name !== "" && !uniquePacks.has(name)) {
      uniquePacks.set(name, {
        name,
        ...(pack.description === undefined ? {} : { description: normalizeText(pack.description) }),
        appliesTo: Object.freeze(pack.appliesTo.map(normalizeText).filter(Boolean)),
      });
    }
  }

  const sortedPacks = [...uniquePacks.values()].sort(comparePacks);
  const body =
    sortedPacks.length === 0
      ? "No installed Knowledge Packs are currently available."
      : sortedPacks.map((pack) => renderPack(pack)).join("\n");
  const complete = renderContext(body);
  if (complete.length <= maxCharacters) return complete;

  const preservedContext = renderContext("", TRUNCATION_NOTE);
  if (preservedContext.length > maxCharacters) {
    return truncate(MINIMAL_TRUNCATION_CONTEXT, maxCharacters, "\n[Catalog truncated]");
  }

  const bodyBudget = Math.max(0, maxCharacters - preservedContext.length - 2);
  const compactEntries: string[] = [];
  for (const pack of sortedPacks) {
    const separatorLength = compactEntries.length === 0 ? 0 : 1;
    const full = renderPack(pack);
    const required = renderPack(pack, false);
    const available = bodyBudget - compactEntries.join("\n").length - separatorLength;
    if (full.length <= available) {
      compactEntries.push(full);
      continue;
    }
    if (required.length <= available) {
      // Preserve the complete Pack name even when its summary no longer fits
      // in the bounded SessionStart context.
      compactEntries.push(required);
      continue;
    }
    break;
  }
  return renderContext(compactEntries.join("\n"), TRUNCATION_NOTE);
}
