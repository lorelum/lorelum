// Local re-declaration of the `lore list packs` summary (ADR 0014). The plugin
// is intentionally outside the Bun workspace, so it does not import
// @lorelum/engine; keep this shape in sync with the CLI contract when either
// side changes.
export interface InstalledPackSummary {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly appliesTo: readonly string[];
}

export interface PackSummarySource {
  readInstalledPackSummaries(): Promise<readonly InstalledPackSummary[]>;
}

export type LorelumHookEvent = "SessionStart" | "PostCompact";

export interface HookInput {
  readonly hook_event_name?: string;
}

export interface HookResponse {
  readonly hookSpecificOutput?: {
    readonly hookEventName: LorelumHookEvent;
    readonly additionalContext: string;
  };
  readonly continue?: boolean;
}
