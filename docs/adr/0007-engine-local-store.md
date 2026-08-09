# ADR 0007: Engine LocalStore storage & lifecycle contract

- **Date:** 2026-07-27
- **Status:** Proposed
- **Related:** ADR 0002 (`bun:sqlite` is the local store), ADR 0003 (Practice/Pack fields and validation the store consumes). Internal docs (Lorelum wiki, "技术规范" section): "定稿：本地 Practice 索引与存储 v1" and "实施计划（重写版）：@lorelum/engine LocalStore". The wiki docs are background and provenance only — this ADR is the authoritative contract (see Decision).

## Context

`@lorelum/engine` must persist installed Knowledge Packs locally and answer `lore query/get/decide/check` without a network round-trip. ADR 0002 already committed the medium (`bun:sqlite`, no native addons) and ADR 0003 froze the Practice/Pack fields the store consumes. What was **not** frozen is the LocalStore's own contract: the on-disk layout, the SQLite entities, the rules for merging Practices that come from different packs, the meaning of the version counter that coordinates the store with the (not-yet-built) vector layer, and the recovery invariants when SQLite and the filesystem disagree.

The "定稿：本地 Practice 索引与存储 v1" doc specifies the intent; this ADR freezes the _contract_ into immutable repo history before code lands. It also resolves four gaps the doc left open, each of which would otherwise force a guess during implementation:

1. **Where is `effectiveRevision` durably recorded?** The doc stored it only in SQLite, but SQLite can corrupt — and the doc simultaneously requires `reindex` to produce a monotonically increasing revision. With the only source of the counter inside SQLite, a corrupt DB breaks the monotonic guarantee. The doc's own reindex rule ("always produces a new revision") needs an independent recovery fact.
2. **What exactly is `canonicalContent`, byte-for-byte?** It is the input to `contentDigest`, and `contentDigest` is the merge/conflict key (same digest → mergeable; different digest → `PracticeConflictError`). So the canonicalization must be reproducible and unambiguous. The doc fixed object field order and LF line endings but left the serialization format, array ordering, and which anti-pattern fields participate unspecified.
3. **What is `storageKey`?** The doc requires it be a "deterministic filesystem-safe encoding" of `pack.name`, but `pack.name` is already constrained to `[a-z0-9-]+` by ADR 0003 — so whether an extra encoding pass is needed was unclear.
4. **Where does LocalStore end and the vector layer begin?** The doc repeatedly has LocalStore write the vector layer's `building` index state and "call the vector layer" inside its own SQLite transaction. But the vector layer (VectorIndex, embeddings, Float32 BLOB, query) is a separate non-goal of this task. Without an explicit seam, an implementation would either invade the non-goal or silently violate the doc.

Finally, the doc and the "实施计划（重写版）" doc referenced "ADR 0007" and "ADR-005" before this ADR existed; this ADR is that referenced artifact, numbered to match the planning docs rather than the strict 0004-next sequence.

## Decision

**This ADR is the authoritative, self-contained contract.** The wiki docs (internal to the Lorelum wiki, not visible to outside contributors) specify the intent and are referenced for provenance; they are background only, not normative — contributors review this ADR alone. Where this ADR and the wiki docs disagree, **this ADR governs**, and the docs are updated to match (see the change list in the References/follow-up).

### 0. Scope (ratified from the doc)

LocalStore owns: the user-level storage root (`~/.lorelum/`), immutable Pack snapshots, the active Pack manifest, the operation journal, the SQLite-derived LocalStore state, Practice canonicalization/digest, source merge and conflict rules, `effectiveRevision` allocation/persistence/read, `install`/`upgrade`/`uninstall`, cold open, recovery, and `reindex`.

LocalStore does **not** own: VectorIndex, embedding providers, vector tables, Float32 BLOBs, sqlite-vec/LanceDB, ANN, in-memory vector snapshots, or semantic query. The vector layer will consume LocalStore's Effective Practice output and `effectiveRevision` and must not re-parse Packs or re-adjudicate source conflicts. Pack-to-pack dependencies are not supported in v1.

### 1. `effectiveRevision` recovery source — written to the active manifest

`effectiveRevision` is recorded in **two** places, with the manifest as the authoritative recovery fact:

- **Active manifest (`installed-packs.json`)** gains a top-level `effectiveRevision: number` field, alongside the existing `schemaVersion` and `generation`. This is the recovery source of truth.
- **SQLite store metadata** keeps a derived `effectiveRevision` copy (§3.1) for transactional consistency on the read/write path.

Increment rules (frozen):

- A normal mutation (`install`/`upgrade`/`uninstall`) increments `effectiveRevision` **iff** the Effective Practice _set_ changes or an existing Practice's _effective content_ changes.
- Adding or removing a source whose content is identical to what is already effective does **not** increment (it only adjusts source rows).
- A successful `reindex` **always** produces a new `effectiveRevision`.
- **Generation coupling:** `generation` increments on **any** active-manifest content change — including a reindex that only changes `effectiveRevision`. A reindex is a manifest mutation: it bumps `generation` _and_ `effectiveRevision` together. SQLite metadata carries both `installedPacksGeneration` and `effectiveRevision` as derived copies, and the two move together atomically in the manifest.

- On recovery, the journal records a `(oldGeneration, targetGeneration, oldEffectiveRevision, targetEffectiveRevision)` tuple, and recovery compares **both** fields: see §8 for the full state machine. (The earlier rule "manifest wins, then reindex issues a fresh revision" is superseded by §8's explicit generation+revision comparison; generation alone can mask a stale revision.)

_Why both places:_ SQLite alone cannot guarantee monotonicity after corruption (the very failure mode `reindex` exists for). The manifest is already an atomic-rename, corruption-recoverable artifact. Storing the counter there costs one integer and removes the gap. _Rejected:_ storing it only in SQLite (doc's original form — fails the recovery invariant); storing it only in the manifest (then every read path pays a manifest parse and loses SQLite's transactional read consistency).

### 2. `canonicalContent` and `contentDigest` — exact serialization

`canonicalContent` is a UTF-8 string produced by `JSON.stringify` over an object with **fixed key order**, LF line endings applied to any multiline text fields, and severity defaults expanded. The canonical object is:

```jsonc
{
  "id": "<string>",
  "title": "<string>",
  "stage": "<string>",
  "tech_stack": ["<string>", "..."],   // author's original array order, preserved as-is
  "applies_when": "<string>",
  "severity": "info" | "warn" | "critical",  // if absent on input, default "warn"
  "body": "<string | ''>",              // absent on input → ""
  "anti_patterns": [                    // author's original order, preserved as-is
    { "id": "<string>", "name": "<string>", "description": "<string>", "severity": "info"|"warn"|"critical" }
    // `check` is EXCLUDED — reserved, format undefined in v1 (ADR 0003 §6)
  ]
}
```

`contentDigest` = `SHA-256(canonicalContent)` as a lowercase hex string. Two Practices with equal `contentDigest` are considered to carry identical content (mergeable).

Frozen choices and why:

- **JSON (stable key order), not YAML or a custom text format.** JSON serialization is deterministic and cheaply comparable; ADR 0003 already treats the Practice as structured data. `JSON.stringify` with a fixed insertion order is reproducible across processes.
- **Author's original `tech_stack` and `anti_patterns` order preserved.** Sorting would change digests retroactively and give no benefit; the order is part of what the author wrote. (Object _key_ order is fixed by this ADR; _array_ order is the author's.)
- **`severity` default `"warn"` injected here**, matching ADR 0003's spec default. This is why `@lorelum/format`'s schema deliberately has _no_ default (it must surface "author omitted severity" as a validate warning) — canonicalization is the consumer that injects the default. _This is the canonicalizer's responsibility, living in `model/canonical-practice.ts`._
- **`body` absent → `""`.** An empty body is still distinct from no body at the schema level, but for digest purposes both canonicalize to an empty string (an author who omits guidance and one who writes nothing are indistinguishable to retrieval).
- **`anti_patterns[].check` excluded.** ADR 0003 leaves `check` undefined in v1; including an unknown-shaped field in the digest would make digests unstable if the field's representation changes. Excluding it keeps v1 digests forward-compatible.

### 3. SQLite data contract (ratified field-for-field from the doc §3)

Implementation SQL table names may differ; the entities, fields, and uniqueness constraints below are the v1 contract.

- **3.1 Store metadata** — `schemaVersion` (LocalStore schema version), `installedPacksGeneration` (the active-manifest `generation` applied to SQLite), `effectiveRevision` (derived copy; the manifest is authoritative — see §1).
- **3.2 Active Pack** — `packName` (unique; = `pack.yaml.name`), `packVersion`, `artifactDigest`, `storageKey`, `installedAt`. `(packName, artifactDigest)` must match an active-manifest entry.
- **3.3 Practice source** — `packName`, `practiceId` (composite key, `(packName, practiceId)` unique), `contentDigest` (SHA-256 of this source's canonical content), `sourcePath` (relative to the Pack snapshot, for diagnostics and rebuild verification).
- **3.4 Effective Practice** — `practiceId` (unique), `contentDigest` (current effective content digest), `canonicalContent` + retrieval metadata (materialized from the verified Practice parse), `effectiveRevision` (the revision this record was written under).

The **read path** uses a single, deterministically ordered SQL statement that returns Effective Practice rows joined with their source rows, materialized in memory grouped by `practiceId`. Both the public read API and the cold-open verifier use the same materializer. **No N+1 queries** (read effective row, then per-practice source lookup) — this was a defect in the prior abandoned implementation.

### 4. Vector layer seam — LocalStore does not write vector state

This ADR clarifies the boundary the doc left ambiguous:

- LocalStore owns **its own SQLite tables only** (§3.1–§3.4). It does **not** write the vector layer's `profile` / `vector record` / `binding` / index-`status` tables, and it does not perform or await embedding.
- `install`/`upgrade`/`uninstall` commit LocalStore state in one SQLite transaction. The increment of `effectiveRevision` happens in that transaction (§1). On commit, LocalStore invokes a **pluggable hook** (default: no-op) that the future vector layer will implement to receive `(newRevision, delta: { added, changed, invalidated })`. The hook is invoked **after** the transaction commits, never inside it.
- For this task (LocalStore only), install/upgrade/uninstall return success based on **LocalStore commit** alone. The doc's rule "CLI returns success only when the semantic index reaches the target `ready` revision" is **deferred** to the task that implements the vector layer; until then, LocalStore's own success/failure is the whole truth. This is recorded so a future PR does not need to re-litigate it.

_Why not write vector state in the LocalStore transaction (as the doc literally said):_ the vector layer is an explicit non-goal of this task, embedding calls must not run inside a SQLite write transaction (the vector doc requires this), and coupling the two layers' writes would re-introduce the "half-installed readable state" defect the doc's journal protocol exists to prevent. A post-commit hook keeps LocalStore the single writer of its own tables while letting the vector layer observe revisions.
Hook failure and ordering (frozen):

- **Hook failure never rolls back a committed mutation.** The hook runs _after_ the SQLite transaction commits. If it throws or rejects, the LocalStore mutation **stays successful**; the result object carries a `notificationPending` diagnostic (which hook revision failed, the error). This is non-negotiable: the whole point of the post-commit seam is that a future vector-layer outage must not turn a completed install/upgrade/uninstall into a reported failure (the defect the §3.3 GC rule and this ADR exist to prevent). Recovery of a pending notification is the vector layer's concern (`lore reindex` re-emits the delta for the current revision).
- **Strict serial, in-revision-order delivery.** The hook is invoked serially per LocalStore instance, in monotonically increasing `effectiveRevision` order, never concurrently. A revision's delta is delivered at most once per process; a missed revision (process crash between commit and hook) is recovered by `lore reindex`, which re-derives and re-emits. The vector layer may rely on receiving a contiguous, ordered delta stream — it must not have to de-dupe or reorder.
- **No-op default means no blocking.** Until the vector layer registers a real hook, the default no-op returns immediately; install/upgrade/uninstall latency is unaffected.

### 5. `storageKey` — `p-${pack.name}`

`storageKey` is the string `` `p-${pack.name}` `` (the literal prefix `p-` followed by `pack.name`). It is **not** `pack.name` verbatim. ADR 0003's `PACK_NAME_REGEX` (`^[a-z0-9]+(-[a-z0-9]+)*$`) admits Windows reserved device names — `con`, `aux`, `nul`, `prn`, `com1`–`com9`, `lpt1`–`lpt9` — which are illegal or behave as devices when used as directory names on Windows, so the earlier "no reserved-name risk" claim does not hold across platforms. The fixed `p-` prefix sidesteps this without touching the public Pack schema (`pack.name` remains the stable install identity and the regex stays unchanged): no value matching `PACK_NAME_REGEX` can equal a Windows reserved name once `p-` is prepended, the mapping is trivially reversible (`pack.name = storageKey.slice(2)`), and the prefix is filesystem-safe on all supported platforms. The manifest carries `storageKey` per entry and the reverse mapping is structural, not a separate index. _Follow-up:_ if `PACK_NAME_REGEX` is widened (e.g. upper case, Unicode), re-validate that `p-` prefixing alone still excludes reserved names and path-traversal; if not, `storageKey` gains a real encoding pass in its own ADR. Rejected alternatives: extending `PACK_NAME_REGEX` to forbid reserved names (changes the public schema every pack author sees, and the reserved set is Windows-specific); percent/hex encoding (reversible but obscures the directory name and gains nothing over a prefix).

### 6. Disk layout and atomicity (ratified from the doc §2)

```
~/.lorelum/
  installed-packs.json                     # active manifest (schemaVersion, generation, effectiveRevision, packs[])
  store.sqlite                             # LocalStore tables + (future) vector layer tables
  packs/<storageKey>/<artifactDigest>/     # immutable, expanded Pack snapshot + .lorelum/local-store-projection.json
  staging/<operation-id>/                  # in-progress operation scratch
  operations/<operation-id>.json           # operation journal
```

`StorageRoot` must be caller-injectable (default `~/.lorelum/`); tests and CI use an injected root. v1 does not read or create a project-level `.lorelum/`. All file writes use a temp path + atomic rename; no in-place overwrite of an active snapshot or the active manifest. `staging/` and `operations/` are never read by the query path. Directory names never trust an external Pack name directly — they use `storageKey` (`` `p-${pack.name}` ``, §5).

### 7. Merge, conflict, and install/upgrade/uninstall semantics (ratified from the doc §4–§6)

- Practice identity = `practice.id`. Title is not an identity key.
- Same `practice.id` + same `contentDigest` → establish an additional Practice source; exactly one Effective Practice.
- Same `practice.id` + different `contentDigest` → reject the install/upgrade with `PracticeConflictError` (carries `practiceId`, candidate pack, conflicting active pack). Not resolved by install order, version, or title.
- `install` = first install of a not-yet-active `pack.name`. Same `artifactDigest` re-install is idempotent-success, no state change; different `artifactDigest` requires `upgrade`.
- `upgrade` of a `packName` first removes that pack's current sources from the candidate set before computing conflicts — so only this pack's uniquely-provided Practices can change content; if another active pack still provides the old content, the upgrade must fail on conflict.
- `uninstall` removes the pack's Practice sources; an Effective Practice is deleted only when it has zero remaining sources. Deleting a non-existent pack returns `PackNotInstalledError` (never silent success).

### 8. Cold open, recovery, reindex (ratified from the doc §7)

- **Cold open** runs schema migration, parses the active manifest, checks SQLite readability/integrity, checks each active artifact exists with a matching digest, and reads the digest-protected projection. It reconciles SQLite's Active Pack / Practice source / Effective Practice against the projection (re-canonicalizing materialized fields and checking they still hash to the stored `contentDigest`). It does **not** scan all Packs, re-parse Practice files, or regenerate embeddings. On any inconsistency it returns `StoreRecoveryRequiredError`.
- **`lore reindex` is the recovery entry point and bypasses cold open.** It does **not** call the normal `open()` path — cold open refuses a corrupt/missing/inconsistent SQLite with `StoreRecoveryRequiredError`, but `reindex` must succeed _precisely_ in that situation. `reindex` takes the active manifest's Pack snapshots as its only input, re-runs format validation and LocalStore derived-data construction (Active Pack, Practice source, Effective Practice, projection re-canonicalization), generates a fresh `effectiveRevision`, and hands the delta to the vector seam (§4). If `store.sqlite` is missing or corrupt, `reindex` recreates it from scratch (re-run migrations, repopulate all derived tables from the manifest + artifacts); if it is merely inconsistent (wrong generation/revision tuple), `reindex` overwrites the derived state to match the manifest. It verifies re-parsed Pack/Practice/source paths match the sealed projection. It never scans historical artifacts or revives uninstalled packs. If the active manifest, original artifacts, or format validation itself is unavailable, it fails and preserves diagnostics; it must not delete the only remaining recovery source. (Normal `install`/`upgrade`/`uninstall` still go through `open()`; only `reindex` is the bypass.)

- **Operation journal & cross-medium recovery state machine.** The filesystem and SQLite have no shared transaction, so each manifest-mutating operation (`install`/`upgrade`/`uninstall`/`reindex`) writes a journal record carrying `{oldGeneration, targetGeneration, oldEffectiveRevision, targetEffectiveRevision, oldManifest, targetManifest}` before publishing the target manifest. `oldManifest` and `targetManifest` are complete, schema-validated manifest payloads, not deltas; they are the recovery preimage and target image, so rollback never reconstructs a Pack list from tuple values. On success, the operation advances the manifest's `generation` and (if applicable) `effectiveRevision` together. Recovery compares **both** `(generation, effectiveRevision)` from the journal against SQLite's derived `(installedPacksGeneration, effectiveRevision)` — generation alone is insufficient because a reindex that only advanced the revision leaves `installedPacksGeneration` unchanged while the revision differs. The state machine: (a) SQLite tuple == journal `target` tuple → atomically publish `targetManifest` if it is not already active, then clear the journal. (b) SQLite tuple == journal `old` tuple → atomically restore `oldManifest`, then clear the journal. (c) SQLite tuple matches neither (partial commit, corrupt SQLite, schema mismatch, or any single-field mismatch where the other matches) → return `StoreRecoveryRequiredError` and require `lore reindex`; never expose a queryable half-state. Cold open (§8 bullet 1) runs this check; it never silently picks "the newer one." A reindex is not special-cased: it is a manifest mutation that bumps `generation` and `revision` together and journals both, so its recovery path is identical to install/upgrade/uninstall.

- **Lock-free read consistency protocol.** A public read or cold-open verification may not assume a separately read manifest and SQLite transaction form a coherent pair. It reads and validates manifest A, opens one SQLite read transaction and materializes metadata plus Effective Practices, validates the metadata tuple against A, then reads and validates manifest B. It returns data only when A and B have identical canonical manifest bytes and the SQLite tuple equals their `(generation, effectiveRevision)`; otherwise it retries a bounded number of times and then returns `StoreBusyError`. A mismatch that is stable after retries is treated as `StoreRecoveryRequiredError`, not as an opportunity to select one side.

### 9. Acceptance matrix (maps the doc's §9 to this task's scope)

The doc's §9 lists seven acceptance behaviors. Their disposition under this ADR:

| Doc §9 behavior                                                                                                                                                            | Disposition                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. Default root + StorageRoot injection + manifest/artifact write & restart read                                                                                           | **Implement** (PR 2)                                         |
| 2. install / idempotent install / upgrade-required / upgrade removes old sources                                                                                           | **Implement** (PR 2)                                         |
| 3. Same-title-different-id coexist; same-id-same-digest merge; same-id-different-digest reject; upgrade-vs-other-source conflict reject                                    | **Implement pure rule** (PR 1a model) **+ integrate** (PR 2) |
| 4. Uninstall keeps still-sourced Effective Practice; last-source removal deletes it; vector invalidation hook fires                                                        | **Implement** (PR 2); vector invalidation = no-op hook (§4)  |
| 5. Crash recovery via journal comparing the `(generation, effectiveRevision)` tuple (not generation alone); reindex bumps both together; no queryable half-installed state | **Implement** (PR 2)                                         |

| 6. Source-only change does not increment revision; effective content change does increment and passes the same revision to the vector seam | **Implement pure rule** (PR 1a) **+ integrate** (PR 2); "passes to vector seam" = hook call (§4) |
| 7. Corrupt/missing SQLite, schema-incompatible, missing/digest-mismatched artifact, invalid projection, manifest↔SQLite/generation mismatch, tampered source digest or Effective Practice content → `StoreRecoveryRequiredError`; `reindex` restores from active manifest + original snapshot without reviving history | **Implement** (PR 2) |
| (doc §9 integration with vector layer) target revision ready before query succeeds | **Deferred** to the vector-layer task (§4); not in scope here |

### 10. Validation gating and Pack snapshot parsing (SnapshotCodec)

Freeze how LocalStore consumes `@lorelum/format` so the storage layer never guesses at edge cases.

- **Gate on `report.valid` only.** `validatePack()` returns `{ valid, errors, warnings, infos }`. LocalStore proceeds to staging **iff `report.valid === true`** (errors empty). `warnings` and `infos` **do not block** installation; they are surfaced through the install result object (each carries `code`/`path`/`message`) so the CLI can show them, but they are not errors. This matches ADR 0003's reframe: warnings are author quality-signals, not runtime blockers.
- **SnapshotCodec owns Pack-file → PackInput assembly.** A new `SnapshotCodec` (the planning doc's name; lives under `storage/artifacts/` alongside `artifact-store.ts` and `projection.ts`) is the sole component that reads the on-disk Pack snapshot and assembles the `{ pack, practices, decisions }` consumed by `validatePack`. Responsibilities: read `pack.yaml`; discover Practice files; parse each Practice's frontmatter via `@lorelum/format`'s `parseFrontmatter`; assemble `PackInput`.- **File path & YAML parsing ownership.** The codec lives at `packages/engine/src/local-store/storage/artifacts/snapshot-codec.ts` (PR 1 storage scope). `@lorelum/format` exposes `parseFrontmatter` (Markdown frontmatter) but **not** a general YAML parser; `pack.yaml` and `decisions.yaml` are pure YAML, not Markdown. To avoid reaching into `gray-matter`'s transitive `js-yaml` dependency (a private implementation detail of format), YAML parsing is owned as follows: **`@lorelum/format` gains a thin `parseYaml(text): unknown` entry point** that wraps the same `js-yaml` it already pulls in for frontmatter, re-exported from `@lorelum/format`'s public surface. `SnapshotCodec` calls `parseYaml` for `pack.yaml`/`decisions.yaml` and `parseFrontmatter` for Practice `.md` files. This keeps a single YAML dependency in the workspace (no engine-side `js-yaml`), and a future swap of the YAML library (per ADR 0002's gray-matter note) stays a one-package change. _If `@lorelum/format` declines to expose `parseYaml`, the fallback is a direct, declared `js-yaml` dependency in `@lorelum/engine/package.json` — never an implicit transitive import._

- **`body` is injected by the codec, not authored in YAML.** The Practice frontmatter carries structural fields (`id`/`title`/`stage`/`tech_stack`/`applies_when`/`severity`); the guidance `body` is the Practice Markdown's content (frontmatter body), injected by `SnapshotCodec` into the `Practice` object. Pack authors write guidance as Markdown prose, not as a YAML string. (This is why `Practice.body` is optional in the schema — it's absent in raw frontmatter and present after codec assembly.)
- **`decisions.yaml` is optional and has one v1 shape.** A Pack with no `decisions.yaml` is valid and assembles an empty `DecisionNode[]` (not an error). When present, the YAML document must be a top-level sequence of Decision Nodes (for example, `- id: state.client-vs-server`); wrapper objects such as `{ decisions: [...] }`, `null`, and an empty document are format errors. This maps directly to `PackInput.decisions`.
- **Practice discovery + source path normalization.** Practice files live under `practices/**/*.md` relative to the Pack root. The `sourcePath` recorded in the Practice-source table is the POSIX-style relative path from the Pack root (forward slashes, normalized, no `./`/`../`, no trailing slash), stable across platforms. Only `.md` files are discovered. The discovery set is fixed at snapshot-seal time and recorded in the projection, so re-parse during reindex finds the identical set.

### 11. Artifact digest — exact algorithm

`artifactDigest` must be reproducible across processes and platforms (it gates artifact promotion and cold-open verification). Frozen algorithm:

- **File set.** Recursively include every file under the expanded Pack snapshot directory, **including** the engine-generated `.lorelum/local-store-projection.json` — it is the _only_ `.lorelum/` file in the snapshot, and including it binds the projection cryptographically to the author's bytes (closing the "synchronous tampering" gap: an attacker who edits the projection must also re-derive `artifactDigest`, which requires changing author bytes that the digest also covers). Dotfiles elsewhere and empty directories are ignored; symlinks are not followed (snapshots are materialized). The file set is fixed at seal time; the projection is generated **before** the digest is computed, so the digest covers it.

- **Path sorting.** Files are sorted by their POSIX relative path (forward slashes, Unicode code-point order — i.e. JS default string sort on the UTF-16 units, equivalent to byte order for the BMP). Sort happens before concatenation.
- **Encoding.** The digest input is the concatenation, for each file in sorted order, of: the literal relative path bytes (UTF-8), a single `NUL` byte (`0x00`) as a path/content separator, the file's raw bytes, and a single newline byte (`0x0A`). No length prefix (the NUL terminator disambiguates). The whole concatenation is hashed with SHA-256, lowercase hex.
- **Line endings.** Text files keep their on-disk bytes verbatim — the digest does **not** normalize CRLF→LF (that normalization is canonical-content's job, §2, applied per-Practice at digest time). The artifact digest protects the exact bytes the author shipped; reindex re-parses those exact bytes.
- **Projection role.** `.lorelum/local-store-projection.json` is **generated by the engine** (not authored), is the only `.lorelum/` file in the snapshot, and is **included** in the artifact-digest file set (see File set above). Two consequences: (a) the projection's integrity is enforced by `artifactDigest` — a projection edited in isolation recomputes the directory digest to a different value than the active manifest's recorded `artifactDigest`, so cold open rejects it without needing to re-parse Practices; (b) **the projection object must NOT carry an `artifactDigest` field** (it would be self-referential and circular — the digest is computed over a file set that includes the projection). The projection's fields are `pack` metadata + per-Practice `{ id, contentDigest, canonicalContent, sourcePath }`. Cold open _additionally_ re-canonicalizes each Practice from the snapshot bytes and asserts the recomputed `contentDigest` equals the projection's — this catches a synchronous tamper of _both_ the author bytes and the projection (which would force a matching `artifactDigest`) by re-deriving canonical content from the (altered) bytes and finding it no longer matches the (altered) projection's stored digests, since the attacker cannot make arbitrary byte edits hash to the same canonical digest. This is why both protections — digest-coverage of the projection _and_ cold-open re-canonicalization — are required; neither alone suffices.

- **Promotion rule.** When promoting a staged snapshot to `packs/<storageKey>/<artifactDigest>/`, if the target directory already exists, LocalStore verifies the staged digest equals the on-disk artifact digest (re-derive it from the target's files). If they match, the promotion is a no-op (idempotent). If they differ, the target is an unrelated/corrupt artifact — promotion is rejected unless the target is unreferenced by the active manifest, in which case it is replaced (the §3.3 GC-safe rule).

### 12. Mutation lock — minimal contract

The `mutation-lock.ts` component (PR 2) gets a frozen minimal contract so concurrency behavior is not invented ad hoc.

- **Scope: cross-process, per-StorageRoot.** The lock is a single advisory lock per storage root (`~/.lorelum/`), enforced across processes (two `lore` invocations must not mutate concurrently), held by exactly one writer at a time. Lock file lives under the storage root (e.g. `<root>/.lock`), acquired by atomic create-or-fail (e.g. `O_EXCL`), released on process exit.
- **Mutations are exclusive; reads are lock-free.** `install`/`upgrade`/`uninstall`/`reindex` acquire the lock for the whole operation. Cold open and the public read path (Effective Practice materialization) do **not** acquire the lock — they read a consistent `(manifest, SQLite snapshot)` pair. This is safe because manifest writes are atomic-rename and SQLite gives a transactional snapshot; a read never blocks on embedding or cleanup.
- **Wait vs. fail.** Default: a mutation that finds the lock held **waits** with a bounded timeout, then fails with `StoreBusyError` (typed, surfaced to CLI) rather than silently spinning or clobbering.
- **Stale-lock recovery.** On open, if a lock file exists but its holder is not alive (the lock record carries PID + start time; the holder process is gone), the lock is reclaimable. Reclaim is allowed only after the operation journal's recovery check (§8) has run and the store is in a consistent `(generation, revision)` state — reclaiming a lock never skips recovery. If recovery is required, the lock is not reclaimed; `StoreRecoveryRequiredError` is returned instead.
- **Failure model.** Lock acquisition failure, timeout, and stale-lock-with-pending-recovery are the only lock-related error modes. None of them corrupt state; all surface as typed errors. A crash mid-mutation leaves a stale lock + a journal record, both resolved by the next open's recovery path.

### 13. Minimal public API and recovery entry (frozen for PR 2)

PR 2 exposes the LocalStore public surface from `packages/engine/src/index.ts` (PR 1a/1b do not export it). The minimal API (PR 1 model types may be re-exported as types only):

```
type StorageRoot = { readonly rootPath: string };   // injectable; default resolves ~/.lorelum/

interface LocalStore {
  open(root: StorageRoot): Promise<OpenResult>;       // cold open; throws StoreRecoveryRequiredError on inconsistency
  install(root: StorageRoot, candidate: PackCandidate): Promise<InstallResult>;
  upgrade (root: StorageRoot, candidate: PackCandidate): Promise<InstallResult>;
  uninstall(root: StorageRoot, packName: string):     Promise<UninstallResult>;
  reindex (root: StorageRoot):             Promise<ReindexResult>;   // recovery entry; bypasses open()
  // read path (lock-free): Effective Practice materialization for a consistent (manifest, SQLite) snapshot
  readEffectivePractices(root: StorageRoot): Promise<EffectivePractice[]>;
  // vector seam (default no-op; vector layer registers a real impl)
  onEffectiveRevisionAdvanced?: (rev: number, delta: RevisionDelta) => void | Promise<void>;
}
```

Result objects (`InstallResult`/`UninstallResult`/`ReindexResult`) carry: the committed `(generation, effectiveRevision)` tuple; the list of Practice ids added/changed/invalidated; any non-blocking `validatePack` warnings/infos; and a `cleanupPending: boolean` + `notificationPending?: { revision; error }` diagnostic (§3.3 GC, §4 hook). Typed errors: `PracticeConflictError`, `PackNotInstalledError`, `StoreBusyError`, `StoreRecoveryRequiredError` (recovery entry: `reindex`). A mutation that committed but whose post-commit hook/notification or GC failed is **success** with a pending diagnostic — never re-reported as failure (§3.3, §4).

## Consequences

**Positive:**

- The LocalStore contract is now frozen in immutable repo history, decoupled from the (mutable) spec doc. Code can point at this ADR as the authority, matching how ADR 0003 underpins `@lorelum/format`.
- `effectiveRevision` has an independent recovery source, so `reindex`'s monotonic guarantee survives SQLite corruption — closing the gap that motivated this ADR.
- `contentDigest` is now unambiguous and reproducible, which is load-bearing because the digest is the merge/conflict key. Two implementations or two runs over the same Practice produce the same digest.
- The LocalStore/vector boundary is explicit, so this task can ship a complete, correct LocalStore without invading the vector-layer non-goal — and the vector layer has a defined hook to consume.
- The `p-${pack.name}` storage key avoids Windows reserved device names without changing the public Pack schema.

**Negative / accepted risk:**

- **`effectiveRevision` in two places** means a write must update both (manifest on atomic rename, SQLite in its transaction) and a recovery path must reconcile them. The §1 reconciliation rule ("manifest wins; SQLite rebuilt") keeps the invariant but adds a small amount of recovery code. Accepted: the alternative (SQLite only) is strictly worse.
- **Canonical-content choices are now frozen.** Any later change to severity default, field inclusion, or serialization changes every existing digest and forces a re-index of all installed packs. Mitigation: `canonicalizerVersion` is carried by the (future) vector embedding profile, so a canonicalizer change is detectable and recoverable via `reindex`; but LocalStore's own digest comparison must use the canonical content this ADR fixes. Changing any of §2 requires a superseding ADR.
- **`check` excluded from the digest** means two anti-patterns that differ only in an experimental `check` value would share a digest. Accepted: `check` is undefined in v1 and packs do not carry it; when it is defined, that definition lives in its own ADR and this exclusion is revisited.
- **Vector seam deferred.** Until the vector layer lands, install/upgrade/uninstall succeed based on LocalStore commit alone, so there is no moment where "LocalStore says success but the index isn't ready." This is correct for this task but the doc's stronger rule (success requires ready index) is intentionally not yet in force — future PRs must not assume it is.
- **Gap in ADR numbering.** This ADR is numbered 0007 to match references already present in the planning docs and the "定稿" doc, leaving 0004–0006 unused. The repo's ADR convention requires monotonic _non-reused_ numbers, which 0007 satisfies; the gap is cosmetic.

**Follow-ups:**

- Update the internal "定稿：本地 Practice 索引与存储 v1" doc to match §1 (add `effectiveRevision` to the manifest field list and §3.1), §2 (canonical-content definition), §4 (vector seam clarification), §5 (`storageKey = p-${pack.name}`), and §9 (acceptance-matrix dispositions). The doc and this ADR must not drift.
- Implementation lands in the `@lorelum/engine` package per "实施计划（重写版）": `model/` (pure rules) → `storage/` (SQLite + filesystem) → `lifecycle/` (open/install/upgrade/uninstall/reindex/recovery), with a pluggable `onEffectiveRevisionAdvanced` hook defaulting to no-op.
- When the vector layer task opens, it implements the hook (§4) and activates the doc's "success requires ready revision" rule; that work carries its own ADR referencing this one.
- If `PACK_NAME_REGEX` is widened, `storageKey` gains an encoding pass (new ADR).

## References

- ADR 0002 — `bun:sqlite` is the local store medium; native Node addons (`better-sqlite3`) are deliberately avoided.
- ADR 0003 — Practice/Pack fields consumed by LocalStore; `PACK_NAME_REGEX` whose Windows-reserved names are made safe by the `p-` storage-key prefix; `severity` default `warn` injected by the canonicalizer.
- Internal docs (Lorelum wiki, "技术规范" section — background only, not normative): "定稿：本地 Practice 索引与存储 v1" (provenance for disk layout, SQLite contract, merge/conflict rules, cold open/recovery/reindex), "定稿：本地向量索引存储方案v1" (downstream vector-layer contract this ADR's seam feeds), "实施计划（重写版）：@lorelum/engine LocalStore" (three-layer implementation plan this ADR unblocks).
