export interface GuidanceProfile {
  readonly description: string;
  readonly catalog: string;
  readonly readHints: string;
}

const sharedCatalog =
  "Use a Pack Catalog already available in the task context. Its descriptions and stack scopes help identify potentially relevant Packs, but do not rule out other Packs. If no usable Catalog is available and Pack discovery matters for this task, run `lore pack list --details` once. Do not run it just because the task started.";

const ompCatalog =
  "Use a Pack Catalog already available in the task context. Its descriptions and stack scopes help identify potentially relevant Packs, but do not rule out other Packs. Main receives the Catalog; task/eval children do not by default (`agent.subagentPackCatalog: false`). Do not run `lore pack list --details` merely because a child has no Catalog or bootstrap a Catalog automatically. Independent Pack discovery is allowed when a material decision in the assigned task actually requires it; then list once and reuse the result.";

const ompReadHints =
  "Read-Practice hints in an omp child come from successful gets by the originating Main session, including in nested task/eval children. They are possibly relevant metadata, not the full guidance or proof of adoption. Read a candidate in full before using it; your own reads belong to your session and are not automatically added to Main's candidates. Enabling `agent.subagentPackCatalog: true` adds only Pack routing metadata, never complete Pack or Practice bodies.";

export const guidanceProfiles = {
  generic: {
    description:
      "Retrieve relevant engineering Practices from installed Lorelum Packs when an engineering decision needs guidance.",
    catalog: sharedCatalog,
    readHints: "",
  },
  claude: {
    description:
      "Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision.",
    catalog: sharedCatalog,
    readHints: "",
  },
  codex: {
    description:
      "Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision.",
    catalog: sharedCatalog,
    readHints: "",
  },
  cursor: {
    description:
      "Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision, including through the /lore command.",
    catalog: sharedCatalog,
    readHints: "",
  },
  omp: {
    description:
      "Retrieve relevant engineering Practices from installed Lorelum Packs when an engineering decision needs guidance.",
    catalog: ompCatalog,
    readHints: ompReadHints,
  },
  workbuddy: {
    description:
      "Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision, including through the /lore command.",
    catalog: sharedCatalog,
    readHints: "",
  },
  zcode: {
    description:
      "Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision, including through the /lore command.",
    catalog: sharedCatalog,
    readHints: "",
  },
} as const satisfies Readonly<Record<string, GuidanceProfile>>;

export type GuidanceProfiles = Readonly<Record<string, GuidanceProfile>>;
