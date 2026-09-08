# ADR 0013: LocalStore canonical projection uses affected-ID writes

- **Date:** 2026-09-08
- **Status:** Accepted
- **Related:** [Issue #73](https://github.com/lorelum/lorelum/issues/73), [ADR 0007](./0007-engine-local-store.md), [ADR 0012](./0012-persistent-keyword-index.md)
- **Decision authority:** Lorelum Owner. Approved for implementation on 2026-09-08.
- **Supersession on acceptance:** Supersedes ADR 0007's normal-mutation requirement to run a full cold-open audit before every write. It does not change `open()` or `reindex()` recovery behavior.

## Context

Before this decision, every LocalStore mutation materialized all Effective Practices, ran the complete artifact/projection audit, deleted all canonical SQLite projection rows, and reinserted the full Store. A one-Practice installation therefore grew with the whole Store: the observed p50 was 121ms at 1,000 Practices, 596ms at 5,000, and 2,460ms at 20,000.

The manifest remains authoritative for active artifacts; `store.sqlite` is a canonical, validated projection used for reads, source reconciliation, revision history, and query summaries. A journal records complete old and target manifests, and recovery compares their `(generation, effectiveRevision)` tuples with SQLite. The mutation optimization must preserve that transaction and recovery boundary.

## Decision

### 1. Normal mutations work from affected Practice IDs

Install reads IDs supplied by the candidate. Upgrade reads their union with the previous source IDs of the replaced Pack. Uninstall reads the removed Pack's source IDs. The existing reconciliation rules run on exactly that complete affected source set; conflict detection and `RevisionDelta` calculation are not duplicated.

The SQLite transaction upserts or removes one active-Pack row, replaces source/effective rows only for affected IDs, updates metadata, and appends outbox/revision-log records atomically. It uses `ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE`, because replacement would delete a parent row and trigger foreign-key cascades. `writeDerivedState()` remains the explicit full-rebuild writer for reindex.

### 2. An Effective Practice row records its own last content revision

`effective_practices.effective_revision` means the effective revision that last added or changed that Practice's canonical content. It need not equal the Store's current metadata revision. Materialization accepts a safe non-negative row revision no greater than metadata's `effectiveRevision`; a future row revision remains invalid.

Existing rows already satisfy this representation, so no table rewrite or schema migration is needed. Metadata and the manifest tuple remain the identity of a complete Store snapshot. Source-only mutations update sources and generation but retain the row's last content revision and do not append an effective-revision delta.

### 3. Mutation preflight is narrower than cold open

Normal mutations still hold the cross-process mutation lock, converge journals, and verify the manifest/SQLite tuple. They additionally verify the complete `active_packs` table against the manifest and fully materialize/canonicalize every affected row before changing it.

`open()` remains the full artifact digest, sealed-projection, source, and Effective Practice audit. `reindex()` remains the authoritative full rebuild from active artifacts. Consequently, an untouched artifact tampered outside LocalStore APIs may be discovered by `open()` or `reindex()`, rather than by an unrelated small mutation. This boundary is necessary to remove Store-wide work from ordinary writes; it does not permit a committed mixed manifest/SQLite tuple or an affected-row inconsistency.

## Consequences

- Normal small mutations have SQL writes and canonical materialization proportional to affected Practice/source rows, not total Store Practice rows.
- Full reindex and explicit cold open intentionally retain complete validation and rebuild behavior.
- Journal recovery, manifest publication order, outbox ordering, retained revision logs, Pack conflict rules, and public CLI/MCP contracts remain unchanged.
- Tests must cover add/change/remove, source-only updates, conflicts, rollback/recovery, and stale-versus-future row revisions. Benchmarks must separately report lifecycle phases, SQL row counts, and FTS delta query cost.
