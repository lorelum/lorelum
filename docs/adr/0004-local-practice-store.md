# ADR 0004: Local Practice store

- **Date:** 2026-07-26
- **Status:** Proposed
- **Related:** ADR 0003 (Practice & Pack format and validation semantics)

## Context

`@lorelum/engine` needs a persistent LocalStore for installed knowledge Packs and
their Practices. The store is the boundary between the public Pack format and
local retrieval: it must admit only valid Pack content, retain enough durable
information to recover from a damaged derived index, merge identical Practices
from multiple Packs deterministically, and remove a Pack without deleting
content still supplied by another Pack.

This is an architectural decision rather than an implementation detail. The
storage root, persisted recovery sources, identity and conflict rules, and
revision consistency become user-visible behavior once Packs are installed.

The finalized LocalStore design establishes the following constraints:

- `@lorelum/engine` consumes `Practice`, `Pack`, and `validatePack` from
  `@lorelum/format`. A Pack with validation errors is not installed; warnings
  and informational findings retain the lifecycle semantics from ADR 0003.
- v1 is a user-local store. It must not discover or use a project-local
  `.lorelum/` directory.
- LocalStore uses Bun's built-in `bun:sqlite` driver. It adds no runtime npm
  dependency.
- A SQLite database alone is not an adequate recovery source.
- A Practice's stable `id`, not its title, is its cross-Pack identity.

The alternatives considered were a project-local `.lorelum/` root, a JSON-only
query index, SQLite as the only persisted source, and install-order precedence
for conflicting Practices.

## Decision

### Local root and durable state

v1 stores LocalStore data under `~/.lorelum/`. The engine receives a
`StorageRoot` abstraction so tests, CI, and future storage modes can provide an
alternate root without changing LocalStore behavior. Project-local storage is
out of scope for v1.

The durable recovery sources are:

- `installed-packs.json`, the active-Pack manifest with a monotonically
  increasing `generation`;
- immutable unpacked Pack artifacts under
  `packs/<storage-key>/<artifact-digest>/`; and
- an operation journal used to recover interrupted mutations.

SQLite is derived state rather than the sole source of truth. It stores the
active Pack, Practice, source, and revision data owned by LocalStore.

The manifest and artifact layout must be versioned. A damaged or missing
SQLite database is rebuilt from the active manifest and its referenced local
artifacts. Historical artifacts that are no longer active are not scanned to
restore an uninstalled Pack.

### Installation, merge, and removal semantics

Before an install or upgrade is admitted, the engine validates the Pack through
`validatePack` and persists an immutable artifact for the admitted content.
Only one active version of a Pack may exist for each `pack.yaml.name`.

For every active Practice:

- `practice.id` is the identity key. `title` is descriptive content and never
  selects or overrides a Practice.
- The engine computes a canonical `contentDigest`.
- The same Practice id with the same canonical `contentDigest` produces one
  Effective Practice with multiple Practice Sources.
- The same Practice id with a different `contentDigest` rejects the
  install/upgrade with `PracticeConflictError`. v1 has no source precedence,
  partial merge, or automatic conflict resolution.

Uninstall removes the specified Pack's source contribution. An Effective
Practice remains available while at least one active source remains; it is
removed only after its final source is removed. LocalStore does not reconstruct
or merge partially overlapping Practice content: only byte-for-byte equivalent
canonical content, represented by the same digest, is deduplicated.

### Mutation and recovery

Install, upgrade, and uninstall are coordinated mutations over immutable
artifacts, the active manifest generation, the operation journal, SQLite
transactions, and an `effectiveRevision` representing the resulting Effective
Practice set.

On startup and before serving reads, LocalStore recovers an interrupted
operation using the journal and reconciles derived SQLite state from the active
manifest and artifacts when necessary. Reindex rebuilds only from the current
active manifest and referenced artifacts.

### Scope boundary

This ADR defines LocalStore's persistence, identity, source, revision, and
recovery contracts. It selects Bun's built-in SQLite driver, but does not
prescribe SQL table layouts or specify embedding/vector algorithms. A later
vector-index decision may consume LocalStore's effective Practices and
`effectiveRevision`, but is not part of this ADR.

## Consequences

**Positive:**

- Local installations are deterministic and recoverable without depending on a
  derived database.
- Cross-Pack duplicate content is stored and retrieved as one Effective
  Practice while preserving every contributing source for correct uninstall.
- Conflicting guidance cannot silently change retrieval based on installation
  order.
- `effectiveRevision` prevents a query from observing half-applied Pack
  mutations or a stale vector index.

**Negative / accepted risk:**

- Immutable artifacts duplicate Pack content on disk, and journals plus
  recovery add operational complexity.
- v1 gives all projects for one user the same installed-Pack view. Project
  isolation requires a separate future decision.
- Pack-to-Pack dependencies remain unsupported in v1, consistent with ADR 0003.

**Compatibility and migration:**

- v1 introduces the first LocalStore layout, so there is no existing persisted
  layout to migrate.
- The manifest, artifact metadata, SQLite schema, and journal formats require
  explicit versioning and forward migration handling before they are persisted.
- A future project-local store, alternate conflict semantics, or change to the
  recovery source requires a new ADR rather than an incompatible reinterpretation
  of this layout.

**Follow-ups:**

- Write the engine implementation plan, including file ownership, public API,
  typed errors, and the specification's Section 9 acceptance tests.
- Implement LocalStore in `@lorelum/engine` with filesystem-isolated tests;
- Link the implementation PR to the required issue or Discussion before code
  changes are proposed.

## References

- Finalized LocalStore design: https://jcnv104g7m1c.feishu.cn/wiki/UgRGwhGsii1a05kzV9Ics30DnNb
- ADR 0003: Practice & Pack format and validation semantics.
- Issue: https://github.com/lorelum/lorelum/issues/15
