# ADR 0009: Pack localization authoring assets

- **Date:** 2026-09-02
- **Status:** Accepted
- **Related:** ADR 0003, ADR 0004, ADR 0008, [Issue #41](https://github.com/lorelum/lorelum/issues/41)

## Context

Pack authors may keep canonical Practice content in one language while providing faithful localized representations for people who review, browse, teach, publish, or otherwise consume that content. The first concrete need is a Simplified Chinese representation of the English `agentic-coding` Pack.

Calling these files review assets would bind a general content representation to one current use case. Treating each language as a separate Practice or Pack would instead duplicate stable ids and let translations enter conflict resolution, indexing, and retrieval even though this version does not need multilingual runtime behavior.

Lorelum also needs to detect when canonical content has changed since a localization was synchronized. Requiring authors to calculate or edit hashes by hand would move tool responsibility into the Pack source. Conversely, refreshing recorded hashes during ordinary formatting would erase the evidence that a translation is stale.

The current Registry installer intentionally materializes only runtime Pack inputs. Extending Registry metadata, LocalStore artifacts, retrieval indexes, or install options now would expand a low-priority authoring need into a multilingual runtime contract.

## Decision

### 1. Localization is an optional source-authoring layer

A Pack may contain:

```text
<pack-root>/
├── pack.yaml
├── practices/**/*.md
└── i18n/
    ├── manifest.yaml
    └── <locale>/practices/**/*.md
```

Locale directory names use the canonical Unicode locale spelling accepted by `Intl.getCanonicalLocales`, such as `zh-CN`. A localized Practice uses the same path relative to `i18n/<locale>/` as its canonical Practice uses relative to the Pack root. Localized files contain localized Markdown content and do not carry runtime Practice frontmatter.

The terms in the contract are `localization`, `locale`, and `localized content`. Review is one possible consumer, not part of the data model.

### 2. The manifest stores intent and synchronization evidence only

`i18n/manifest.yaml` is strict and contains:

- `schema_version`;
- `source_locale`;
- locale maps whose entries contain a mirrored Practice `path` and tool-generated `source_digest`.

The Pack version comes from `pack.yaml`; Practice ids come from canonical frontmatter; source and localized paths are related by the mirror convention; locale comes from the locale map. The manifest does not repeat those derivable values and does not contain a review-status field.

Partial localization is valid. Tooling reports coverage and synchronization state; a Pack repository may impose a stronger publication policy such as complete coverage for an official locale.

### 3. Digests cover formatted canonical files

`source_digest` is SHA-256 over the UTF-8 bytes of the complete canonical Practice file after applying Lorelum's deterministic Pack Markdown formatter. The formatter normalizes line endings, frontmatter and Markdown representation before hashing, so formatting-only differences do not make localizations stale.

The digest is intentionally conservative: a substantive change anywhere in a canonical Practice requires the corresponding localization to be reconsidered. Lorelum does not define a second “translatable projection” of Practice content.

Authors do not calculate or edit digests. The synchronization operation discovers paths, formats in memory, computes digests, and writes a deterministic manifest.

### 4. Formatting and synchronization are separate state transitions

Pack formatting is mechanical. It may rewrite canonical and localized Markdown and deterministically format the manifest, but it never advances an existing `source_digest`.

Localization validation is read-only. It recomputes formatted canonical digests and reports at least current, stale, missing, and orphaned entries plus structural/path/locale errors.

An explicit localization synchronization operation records that selected localized files, or all localized files in one locale, correspond to the current canonical source. Only this operation creates or advances `source_digest` values.

This prevents `format` from turning a stale translation into an apparently current one while removing all manual hash work from the author workflow.

The CLI exposes the distinction directly:

```sh
lore format <pack-root>
lore validate <pack-root>
lore i18n sync <pack-root> --locale <locale> --practice <practice-id>
lore i18n sync <pack-root> --locale <locale> --all
```

Creating a manifest also requires `--source-locale`; later synchronization reads and preserves it from the manifest. `--practice` and `--all` are mutually exclusive.

### 5. Runtime and distribution remain canonical-only in this version

Localization assets do not enter `PackCandidate`, runtime artifact digests, LocalStore generations or effective revisions, conflict resolution, indexing, retrieval, Decision traversal, or Agent context.

`lore install` continues to materialize only `pack.yaml`, optional `decisions.yaml`, and `practices/**/*.md`. This ADR adds no locale install flag, Registry locale metadata, localized content cache, multilingual embedding/ranking behavior, or CLI message localization.

The agent-first JSON protocol keeps command names, field names, error codes, Practice ids, and enum values stable and unlocalized. Authoring commands and their result/diagnostic schemas remain discoverable through the existing command registry.

## Consequences

### Positive

- Pack authors gain a deterministic, one-command synchronization workflow without maintaining hashes.
- Localized content can serve review, documentation, catalog, IDE, or future display surfaces without committing the runtime to any one of them.
- Canonical installation and retrieval behavior remain unchanged.
- Mirrored paths and derived metadata keep the public auxiliary format small.
- Staleness remains meaningful because formatting cannot silently acknowledge semantic synchronization.

### Negative / accepted risk

- Localized content is not available from an installed LocalStore in this version; consumers read it from Pack source or repository presentation surfaces.
- Any substantive canonical Practice change conservatively makes the localization stale, even when a translator decides no wording change is needed. The explicit sync operation records that decision cheaply.
- Formatter output participates in synchronization identity. Formatter changes that alter normalized bytes require an explicit tooling migration and must not be presented as translator-authored updates.
- Locale validation and filesystem budgets add authoring complexity, but localization directories are untrusted Pack input and need the same containment discipline as other Pack sources.

## Rejected alternatives

- **`--review-locale` during install:** names one consumer and prematurely changes source materialization and storage.
- **Translated Practice ids or separate localized Packs:** duplicates canonical identity and contaminates runtime conflict/retrieval semantics.
- **Per-entry Pack version, Practice id, source path, translation path, or review status:** duplicates derivable data or embeds repository workflow in the content contract.
- **Hash raw unformatted bytes:** makes whitespace and mechanical formatting create false staleness.
- **Hash a separate localizable projection:** introduces a second Practice-content schema without a demonstrated need.
- **Refresh hashes during formatting:** destroys the distinction between mechanical normalization and confirmation that a translation matches changed source content.

## Follow-ups

1. Revisit locale-aware display/export only when a concrete consumer needs installed localized content.
2. Design multilingual retrieval independently and require ranking/retrieval evidence before changing canonical indexing.
3. If formatter evolution changes normalized bytes, define an explicit manifest migration rather than silently advancing synchronization state.

## References

- ADR 0003 — Practice and Pack format and validation semantics.
- ADR 0004 — Agent-first CLI protocol.
- ADR 0008 — Repository Registry and canonical user-scope Pack installation.
- `lorelum/lorelum-packs` Issue #3 — Simplified Chinese localization of `agentic-coding`.
