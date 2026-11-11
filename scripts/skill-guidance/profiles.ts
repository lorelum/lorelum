export interface GuidanceProfile {
  readonly description: string;
  readonly catalog: string;
  readonly readHints: string;
}

const sharedCatalog =
  "Use a Pack Catalog already available in the task context. Its descriptions and stack scopes help identify potentially relevant Packs, but do not rule out other Packs. If no usable Catalog is available and the current decision needs new guidance discovery, run `lore pack list --details` once and reuse it. If you only need to read a known exact Practice ID, do not establish a Catalog solely for that read. Do not run the list just because the task started.";

const ompCatalog =
  "Use a Pack Catalog already available in the task context. Its descriptions and stack scopes help identify potentially relevant Packs, but do not rule out other Packs. Main receives the Catalog; task/eval children do not by default (`agent.subagentPackCatalog: false`). Do not run `lore pack list --details` merely because a child has no Catalog or bootstrap a Catalog automatically. If Main has no usable Catalog and needs new guidance discovery, run `lore pack list --details` once and reuse it. Independent Pack discovery is allowed when a material decision in a child's assigned task actually requires it; then list once and reuse the result. If you only need to read a known exact Practice ID, do not establish a Catalog solely for that read.";

const ompReadHints =
  "Read-Practice hints in an omp child come from successful gets by the originating Main session, including in nested task/eval children. They are possibly relevant metadata, not the full guidance or proof of adoption. Read a candidate in full before using it; your own reads belong to your session and are not automatically added to Main's candidates. Enabling `agent.subagentPackCatalog: true` adds only Pack routing metadata, never complete Pack or Practice bodies.";

const lifecycleDescription =
  "Find and apply Practices for design, code, tests and acceptance; never reset plans. Inspect existing phases, tasks, and statuses before updating them.";

const injectedCatalogDescription =
  `${lifecycleDescription} Use the injected Pack Catalog to discover relevant guidance.`;

const commandDescription =
  `${injectedCatalogDescription} The /lore command is also available.`;

export const guidanceProfiles = {
  generic: {
    description: lifecycleDescription,
    catalog: sharedCatalog,
    readHints: "",
  },
  claude: {
    description: injectedCatalogDescription,
    catalog: sharedCatalog,
    readHints: "",
  },
  codex: {
    description: injectedCatalogDescription,
    catalog: sharedCatalog,
    readHints: "",
  },
  cursor: {
    description: commandDescription,
    catalog: sharedCatalog,
    readHints: "",
  },
  omp: {
    description: lifecycleDescription,
    catalog: ompCatalog,
    readHints: ompReadHints,
  },
  workbuddy: {
    description: commandDescription,
    catalog: sharedCatalog,
    readHints: "",
  },
  zcode: {
    description: commandDescription,
    catalog: sharedCatalog,
    readHints: "",
  },
} as const satisfies Readonly<Record<string, GuidanceProfile>>;

export type GuidanceProfiles = Readonly<Record<string, GuidanceProfile>>;
