# ADR 0014: LocalStore-backed lore list catalog contract

- **Date:** 2026-09-08
- **Status:** Proposed (local implementation)
- **Related:** ADR 0003 (Practice format), ADR 0004 (agent-first CLI protocol), ADR 0007 (LocalStore), ADR 0011 (LocalStore point-read and query boundary), ADR 0012 (persistent keyword index), ADR 0013 (incremental LocalStore projection writes)

## Context

`install`, `query`, and `get` make an installed LocalStore useful only after the caller already knows a Pack name or Practice id. A new conversation often has neither. The owner has confirmed the missing entry point: an agent first discovers installed knowledge, then narrows to one Pack's Practice catalog, and finally uses `lore get` for the full Practice.

The target workflow is:

```text
lore list                  # discover installed Packs
lore list --pack <name>    # inspect that Pack's Practice summaries
lore get <practice-id>     # retrieve the complete Practice
```

`list` is therefore a catalog command, not a task-retrieval command. `query` remains the entry point for finding Practices from task text. An explicit Pack path or Registry lookup would recreate discovery outside LocalStore and split the runtime source of truth.

This ADR defines the CLI/engine catalog contract only. It does not define how an
Agent learns that Lorelum exists or when a Skill, Plugin, Hook, or MCP adapter
should invoke `lore list`; those integrations require separate contracts.

## Decision

### Command surface

```text
lore list [--store-root <path>]
lore list --pack <name> [--store-root <path>]
```

Without `--pack`, the command returns every active local Pack. With `--pack`, it returns that Pack's Practice catalog. Both modes honor the global `--store-root` option through the same invocation Store resolution as `install`, `query`, and `get`.

### Application boundary

`@lorelum/engine` exposes a List application service and deterministic pure projections:

- `LocalStore.open()` includes a minimal `InstalledPackSummary[]` (`name`, `version`) from the verified active manifest;
- Pack version is owned by the active-manifest Pack summary. `EffectivePractice.sources[]` carries the Practice-to-Pack provenance (`packName`, source path, and digests) and intentionally does not repeat Pack version;
- `retrievePacks()` combines those summaries with Effective Practice source claims;
- `retrievePackPractices()` returns only Practices for which the selected Pack has a source claim, or `null` when the Pack is not active;
- `createListService()` cold-opens the selected Store once, projects one of the two catalogs, and converts a missing Pack to `UnknownPackError`.

The CLI adapter performs Pack-name syntax validation, Store-root resolution, service dispatch, and error mapping. It never reads `installed-packs.json`, queries SQLite, scans artifacts, or computes the domain catalog itself. A future MCP tool must validate its own input shape before calling the service.

### Result

Pack-list mode returns LocalStore `generation`, `effectiveRevision`, and `packs[]`. Each Pack contains only:

- `name`;
- `version`;
- `practiceCount`.

`practiceCount` counts effective Practices for which that Pack has at least one source claim. Multiple Packs may claim the same effective Practice; each Pack counts it, so Pack counts do not necessarily sum to the global deduplicated Practice total.

Practice-catalog mode returns `generation`, `effectiveRevision`, `pack`, and `practices[]`. The Pack summary contains `name` and `version`. Each Practice contains only:

- `id`;
- `title`;
- `applies_when`.

The id can be passed directly to `lore get`. Body and anti-pattern content remains intentionally deferred to `get`.

Pack entries sort by `name`; Practice entries sort by `id`. Both comparisons use UTF-16 code units and do not depend on process locale.

### Errors and empty state

A fresh Store is a successful Pack-list result with `packs: []`. A format-valid but uninstalled Pack raises `UnknownPackError`, which the CLI maps to `list.pack-not-found` with exit code 2. This distinguishes an uninstalled Pack from an installed Pack with zero Practices, whose catalog is successful and empty.

The CLI validates `--pack` against `PACK_NAME_REGEX` before Store dispatch and returns `usage.invalid` for malformed input. Engine ListService does not duplicate that format-schema validation. The CLI's `list.pack-not-found` message is generic and does not echo the supplied Pack name; `registry.pack-not-found` remains the separate Registry-install error.

LocalStore `StoreBusyError` and `StoreRecoveryRequiredError` keep their existing CLI mappings.

### Non-goals

Registry search, remote installable Pack discovery, semantic retrieval, ranking, fuzzy matching, pagination, filters, full Practice bodies, MCP wiring, and new Store tables or derived indexes are deferred. Cross-command snapshot consistency is not promised: `list`, `list --pack`, and `get` are separate invocations and may observe different Store revisions.

## Consequences

Once the caller knows the Lorelum CLI entry point, Agents can discover local
knowledge without prior Pack knowledge while keeping LocalStore as the sole
runtime source. This ADR does not claim automatic discovery of Lorelum itself.
The `OpenResult` extension is additive for readers but requires implementations
and test doubles that construct it to provide `packs`; the minimal summary
avoids making artifact digests, storage keys, or install timestamps public
contract fields.

Source-claim counting preserves provenance but means counts are not a global uniqueness metric. The catalog keeps each item to three fields, so an unpaginated Pack can remain useful until observed catalog sizes justify a pagination contract.

**Follow-ups:**

- CLI registration, schema publication, and process integration land with the list implementation.
- User documentation must distinguish browsing (`list`) from task retrieval (`query`).
- A future MCP adapter must define its own input schema and error mapping before exposing this service.
