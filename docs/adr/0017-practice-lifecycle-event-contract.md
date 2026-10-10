# ADR 0017: Practice lifecycle event contract ownership

- **Date:** 2026-10-09
- **Status:** Proposed
- **Related:** [OpenSpec design proposal](../../openspec/changes/define-practice-lifecycle-event-contract/proposal.md), ADR 0004 (agent-first CLI protocol), [agent-integration spec](../../openspec/specs/agent-integration/spec.md), issue #268

## Context

Host lifecycle Hooks can notify Lorelum that a session started, resumed, was cleared, compacted, or forked. They do not establish product-level semantics such as “a new user task started”, “the task scope materially changed”, “a completion result can still be checked before publication”, or “an earlier task's domain guidance may be inherited”. Treating host event names as those semantic events would let downstream orchestration over-trust weak evidence and expand user scope without confirmation.

The current integration contract keeps Hooks metadata-only: they may provide bounded Catalog or session metadata, but must not automatically run `lore query` or `lore get`. Future orchestration needs a reviewed semantic boundary before implementation, while diagnostic Benchmark work also needs a stable reference without becoming a second product authority.

The alternatives were to keep a complete contract in the Benchmark repository, maintain two full copies, or defer all semantics until an orchestrator implementation. Those options respectively separate the contract from product consumers, invite drift, or leave future implementers to infer trust, identity, privacy, and permission rules.

## Decision

If accepted, the product repository will be the sole canonical source for the Practice lifecycle event semantic contract; this Proposed ADR is not yet an active decision. A maintainer versioned contract document records event families, required and conditional semantic information, missing-input handling, versioning principles, host capability evidence levels, and privacy/audit boundaries. A Benchmark-side document may remain temporary design input, but once the product version is accepted it must converge to a version reference, experiment mapping, and evidence boundary rather than a second full contract.

The proposed contract distinguishes:

- host lifecycle facts from product semantic events;
- observed change signals from confirmed material scope changes;
- pre-publication completion checkpoints from post-hoc completion signals;
- context recovery causes (`compact`, `resume`, `clear`, `fork`, `unknown`) and task-inheritance status.

An event never grants an action by itself. Proposed automatic actions default to deny. Local candidate-query construction, submission to a retrieval component, candidate-metadata return, and full task-specific Practice injection require separately versioned authorization scopes and compatible user, host, product-policy, task-identity, idempotency, rate-limit, and audit conditions.

This Proposed ADR and the v0.1 maintainer proposal do not change the current Hook behavior. Automatic `lore query`, `lore get`, candidate return, full Practice injection, or a Trigger Orchestrator requires a separate active OpenSpec change before implementation.

## Consequences

**Positive:** future orchestrator design can reason about event identity, evidence strength, inheritance, and permission rather than inferring them from Hook names. The product repository avoids competing contract authorities while retaining Benchmark evidence about fixed diagnostic delivery positions.

**Negative / accepted risk:** the first contract must remain useful before real-host validation and offline recognition evaluation complete. It therefore marks host capabilities as configuration-declared, behavior-validated, or semantically decidable rather than claiming unsupported validation. A maintainer document is weaker than an accepted capability spec and must not be treated as current runtime behavior.

**Follow-ups:**

- maintain the versioned semantic contract document referenced below;
- validate real host payloads, timing, identity, visibility, and failure paths;
- create an independent offline-recognition evaluation before freezing samples and thresholds;
- resolve the open owner decisions about event names, P1 original-evidence auditing, host validation responsibility, and authorization/audit principles before acceptance;
- open a separate active OpenSpec change before any A4–A6 automatic behavior or orchestrator integration.

## References

- [Active design OpenSpec proposal](../../openspec/changes/define-practice-lifecycle-event-contract/proposal.md)
- [Practice lifecycle event contract](../development/practice-lifecycle-event-contract.md)
- [Issue #268](https://github.com/lorelum/lorelum/issues/268)
