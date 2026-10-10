# Practice lifecycle event contract

> Version: 0.1 (maintainer proposal)
> Status: design contract under review; not current runtime behavior and not an accepted OpenSpec capability.
> Related: [active design OpenSpec proposal](../../openspec/changes/define-practice-lifecycle-event-contract/proposal.md), [ADR 0017](../adr/0017-practice-lifecycle-event-contract.md), [agent-integration spec](../../openspec/specs/agent-integration/spec.md), [issue #268](https://github.com/lorelum/lorelum/issues/268)

## 1. Status and purpose

This document is the product-side semantic contract draft for future Practice lifecycle orchestration. It defines what a lifecycle event means, what information downstream design may trust, what each event can and cannot authorize, how host capability is evidenced, and how the design will be evaluated. It is the reviewable v0.1 semantic proposal, not an accepted canonical contract. If accepted, the Benchmark document will become migration provenance and experiment mapping rather than a competing product authority.

This proposal deliberately excludes production JSON field names, wire encoding, numeric thresholds, a recognition classifier, a Trigger Orchestrator, Hook changes, and automatic lifecycle behavior. Those require separate implementation designs and, where applicable, active OpenSpec changes.

The contract follows four separation rules:

1. a host lifecycle fact is not automatically a product semantic event;
2. an observed signal is not automatically a confirmed semantic change;
3. a confirmed event is not action authorization;
4. authorization for a lower-impact action is not authorization for a higher-impact action.

## 2. Current-boundary statement

Current Hooks remain metadata-only. They may provide bounded Pack Catalog metadata or existing host-contract hints, but do not automatically run `lore query` or `lore get`.

A4 in this document has two different scopes:

- explicit, contract-compliant Skill-initiated targeted query is partially current behavior under the existing agent-integration contract;
- lifecycle-triggered automatic query submission is future behavior, independently scoped, and default-deny.

A1, A3, A5, and A6 lifecycle automation remain proposed. Any automatic A4–A6 lifecycle behavior, Trigger Orchestrator consumption path, or material user-visibility, closing, rate-limit, or degradation change requires a separate active OpenSpec change with observable requirements before implementation; the current design proposal does not authorize it.

## 3. Event model overview

```text
host fact / raw lifecycle event
  -> evidence and identity interpretation
  -> candidate signal
  -> confirmed semantic event
  -> policy/user/host authorization
  -> bounded action
```

The model uses event families with interpretation states rather than treating host event names as task semantics. A processable interpretation records its source, evidence strength, task boundary, and action basis. Unknown identity, source, version, authorization, or idempotency is explicit; it is not inferred from an event name.

## 4. Event catalogue

### 4.1 `task_started`

**Definition.** A new user task has actually started. This is a product semantic event, not a host session event.

**Establishment conditions.** All of the following must hold:

1. there is explicit new-task intent or a confirmed new task boundary;
2. the event can associate to a session, conversation, workspace, or equivalent boundary;
3. the source and interpretation basis are explainable;
4. the boundary is not merely resume, clear, compact, fork, or a host restart.

**Exclusions.** Do not confirm `task_started` for:

- a `SessionStart` without new-task evidence;
- resume of an earlier session;
- compaction while continuing the same task;
- clear before a new user task is stated;
- a fork whose task intent is unknown;
- an automatic host restart or reconnect.

**Positive examples.**

1. A user opens a new task boundary and explicitly asks for a previously undiscussed change with its own acceptance criteria.
2. A product integration confirms a new task boundary and can associate subsequent events to that boundary.

**Negative examples.**

1. Codex or Claude Code delivers `SessionStart(resume)`.
2. A user clears context but has not yet requested work.

**Sources.** A host `startup` fact can seed interpretation, but new-task intent may come from user instruction, a confirmed task boundary, or another authoritative product state. Host restart and session creation alone are insufficient.

**Decision point.** Initialize a lifecycle record, associate later events, and decide whether only generic Catalog or candidate preparation is permitted. This event does not itself authorize automatic query, `lore get`, candidate metadata return, or full Practice injection.

**Degradation.** If task intent or identity is unknown, retain the host fact as recovery or audit input. Do not inherit prior task-domain judgment or perform task-specific higher-impact actions.

**P1 limitation.** Benchmark `task_start` is a scripted delivery position. It does not prove that a real host can recognize `SessionStart` or another input as a new task.
### 4.2 `scope_changed`

**Definition.** The task goals, constraints, material risk, verification requirements, or deliverable scope has changed materially.

This v0.1 uses one event family with two interpretation states. Whether they become two public event names remains an owner decision.

| State | Meaning | Basis examples | Interpretation boundary |
| --- | --- | --- | --- |
| `change_signal_observed` | a possible change was observed | user question, tool finding, Agent inference, document change | record, review, or prepare a local candidate |
| `confirmed material scope change` | a material change is confirmed | explicit user instruction, applicable authoritative document, trusted task state | may enter higher-impact action evaluation |

**Establishment conditions for confirmation.** All of the following must hold:

1. a trusted source explicitly supports the change;
2. the change materially affects task goals, constraints, risk, verification, or deliverables;
3. the change can associate to the current task identity;
4. the interpretation basis is recorded.

**Exclusions.** Do not confirm a material change for:

- an ordinary question or clarification;
- a tool risk finding while the user requirement is unchanged;
- an Agent guess about a possible architecture preference;
- unrelated session content;
- a document change whose applicability to the current task is unconfirmed;
- an implementation detail that does not alter task scope, risk, or verification.

**Positive examples.**

1. The user explicitly adds Safari to a task that previously required Chrome support only.
2. An applicable accepted contract changes the required verification boundary for the current deliverable.

**Negative examples.**

1. The user asks whether the change affects performance but does not alter requirements.
2. A linter reports a risk while the requested task and validation boundary remain unchanged.

**Sources.** User instruction and an applicable authoritative document can support confirmation. Agent or tool inference can support only a candidate signal unless independently confirmed by the user or authoritative task state.

**Decision point.** Update task constraints, request confirmation, reassess whether prior guidance remains applicable, or prepare a local candidate query. Submission, candidate return, and injection remain governed by Section 8.

**Degradation.** Unconfirmed inference never becomes approved scope. If task identity is unknown, retain the signal for review and do not perform task-specific higher-impact actions.

**P1 limitation.** Benchmark `constraint_followup` is a scripted second-round delivery position. It does not prove recognition of real user intent, ordinary questions, tool findings, or Agent inference.

### 4.3 `pre_completion_check`

**Definition.** A result is about to be delivered and can still be checked, corrected, or blocked before publication. The critical ordering requirement is that final content has not yet been delivered.

**Establishment conditions.** All of the following must hold:

1. completion intent or an explicit pre-publication checkpoint is observable;
2. final content, diff, report, or submission has not yet been delivered;
3. the system or Agent can still check, modify, or block it;
4. the event associates to the current task.

**Exclusions.** Do not confirm this event when:

- a completion statement has already been sent to the user;
- the diff is committed or the PR is created before the signal is observed;
- every Stop event fires;
- an arbitrary timer expires;
- an ordinary file changes;
- a Benchmark scripted checkpoint is renamed without semantic justification.

**Positive examples.**

1. An Agent has prepared a final response but has not sent it and can still run required validation.
2. An explicit host or workflow checkpoint allows a review before submission.

**Negative examples.**

1. The Agent has already sent the completion message.
2. A file-save event occurs with no evidence of imminent publication.

**Sources.** A native pre-publication checkpoint or trusted task state can support this event. Stop, timers, file writes, and tool output alone are insufficient.

**Decision point.** Remind the actor to verify original requirements, suggest checks, request missing information, or, only under a separately authorized path, retrieve relevant guidance.

**Degradation.** If timing, task identity, or interception capability is unknown, retain the signal as a candidate or abstain. Do not claim pre-publication authority and do not perform automatic higher-impact actions.

**P1 limitation.** `first_implementation_checkpoint` is a task-script implementation checkpoint, not a universal pre-publication completion event.

### 4.4 `post-hoc completion signal`

**Definition.** A completion statement was already published and is observed afterward.

**Establishment conditions.** The completion statement, final report, or equivalent publication is already visible to the user or external consumer, and the observation can associate to a task boundary.

**Exclusions.** It must not be reinterpreted as a pre-publication checkpoint or used to block the already-completed publication.

**Positive examples.**

1. A final completion message is observed after delivery.
2. An already-created PR completion notice is used as an evaluation sample.

**Negative examples.**

1. A draft final message is prepared but has not been sent.
2. A generic Stop event occurs without a published completion statement.

**Sources.** Published task output, host output, or an external submission fact can support this auxiliary signal. Its timing must remain explicit.

**Decision point.** Use it for audit, retrospective analysis, sample creation, or completion-quality evaluation. Do not use it to claim checking authority over the completed delivery.

**Degradation.** If publication timing is unknown, mark timing unknown and do not classify it as either pre-publication or post-hoc.

**P1 limitation.** P1 provides no evidence for this auxiliary signal.

### 4.5 `context_recovery` / `compaction`

**Definition.** A host context boundary changed and recovery semantics must be interpreted.

| Cause | Interpretation |
| --- | --- |
| `compact` | context was compacted; task identity and inheritance still require confirmation |
| `resume` | an earlier session resumed; same-task identity is not guaranteed |
| `clear` | the user cleared context; old task scope must not be restored by default |
| `fork` | a new context branched; inheritance must be determined separately |
| `unknown` | cause or association is unknown; preserve conservative boundaries |

**Establishment conditions.** A processable interpretation records:

1. a host context-boundary fact;
2. the cause, or explicit `unknown`;
3. an associable session, conversation, or workspace boundary;
4. whether task identity and inheritance are confirmed.

**Exclusions.** This event does not establish that the old task is the same, prior constraints apply, an earlier Practice remains relevant, task content may be restored, or a full task-specific Practice may be injected.

**Positive examples.**

1. A host delivers `SessionStart(compact)` and the event can be associated to the current conversation.
2. A resumed session is separately confirmed to continue the same task.

**Negative examples.**

1. A host session starts without a recoverable cause or boundary identity.
2. A cleared context is treated as permission to restore the prior task domain.

**Sources.** A native host matcher or lifecycle payload is required for a cause-specific interpretation. A bare session event supports only `unknown` unless the host provides a cause.

**Decision point.** Decide whether generic Catalog or a brief generic recovery hint is permitted under the existing host contract, request task confirmation, rebuild task identity, or decide whether explicit field-level inheritance is justified.

**Degradation.** If identity or inheritance is unknown, do not restore prior domain judgment, do not perform non-idempotent automatic actions, and do not inject task-specific full Practice.

**P1 limitation.** P1 has no real compaction, resume, clear, or fork lifecycle node and provides no evidence for this event family.
## 5. Evidence, identity, and inheritance

### 5.1 Source levels

| Level | Meaning | Example |
| --- | --- | --- |
| `host_fact` | the host explicitly reports a lifecycle fact | supported `SessionStart`, `PreToolUse`, or SubagentStart payload |
| `user_instruction` | the user explicitly states an instruction or requirement | the user adds a required browser |
| `authoritative_document` | an applicable authoritative document or accepted contract states the constraint | accepted repository contract or task specification |
| `agent_or_tool_inference` | an Agent or tool infers, discovers, or suggests a condition | test tool reports a risk; Agent guesses a preference |
| `unknown` | source or basis cannot be explained | payload or adapter basis is missing |

Agent or tool inference cannot automatically become user confirmation. Unknown input cannot enter higher-impact actions. Source is an audit input, not an action grant.

### 5.2 Evidence strength

| Strength | Meaning |
| --- | --- |
| `strong` | a host fact, explicit user instruction, or applicable authoritative document directly supports the interpretation |
| `medium` | multiple trusted clues agree, but applicability still needs verification |
| `weak` | one inference, ambiguous clue, or unassociated tool output |
| `insufficient` | information cannot support a confirmed interpretation |

Evidence strength describes interpretation confidence only. It never grants action permission.

### 5.3 Task identity

A processable event must associate to at least one of a task ID, session ID, conversation ID, workspace ID, or equivalent host-provided task boundary. If identity cannot be explained, it is `unknown` and higher-impact task-specific actions are prohibited.

### 5.4 Inheritance

| State | Boundary |
| --- | --- |
| `same_task_confirmed` | prior constraints may be considered, but a Practice is not automatically relevant |
| `partial_inheritance` | only explicitly justified fields may be inherited |
| `new_task_confirmed` | prior task-domain judgment is not inherited |
| `unknown` | do not restore prior domain judgment or perform task-specific higher-impact actions |

## 6. Minimum processable input

A processable event must explain:

1. event family and semantic version;
2. host and adapter identity;
3. native source;
4. observation time or ordering basis;
5. associable session, conversation, workspace, or equivalent task boundary;
6. interpretation state;
7. interpretation basis;
8. source level;
9. information needed to select an authorization policy.

Task ID, workspace ID, native time, recovery cause, inheritance relation, confidence, deduplication relation, sanitized evidence reference, and a query-ready sanitized summary are conditional. Missing conditional values are explicit `unknown`; they are not inferred from an event name.

## 7. Missing-input and version handling

| Condition | Result |
| --- | --- |
| critical identity unknown | record or review only; do not inherit prior task judgment |
| source unexplained | abstain; no higher-impact action |
| version unknown or incompatible | record or abstain; do not apply old rules |
| insufficient basis | candidate signal or abstain; not a confirmed event |
| policy missing | default deny |
| idempotency unknown | no automatic action |

New optional information is compatible only when it does not change prior semantics. Changes to event meaning, establishment conditions, evidence requirements, state meanings, or permission consequences require a new semantic version. Event family, event state, and action rules must remain version-aligned.
## 8. Actions and authorization

| Action | Meaning | Status | Scope boundary |
| --- | --- | --- | --- |
| A1 record/audit | minimal event and decision audit | proposed | separately defined retention and visibility policy |
| A2 generic Catalog or brief recovery hint | host-independent guidance | partially current in existing Hooks | limited by existing host contracts and clear-context semantics |
| A3 construct local candidate query | no retrieval submission | proposed | uses only Section 9 fields; separately defined local retention |
| A4 submit query to retrieval | cross-boundary retrieval input | partially current for explicit, contract-compliant Skill-initiated targeted query; future and independently scoped for lifecycle-triggered automatic submission | existing Skill behavior remains governed by agent-integration; lifecycle automatic submission requires independent A4 scope |
| A5 return candidate metadata | bounded metadata result | future | independent scope, separate from A4 |
| A6 inject full task-specific Practice | complete guidance into context | future | independent scope with highest authorization, relevance, visibility, closing, rate-limit, and audit requirements |

Authorization is evaluated in order:

```text
recognizable event version
  -> valid confirmed interpretation
  -> sufficient task identity
  -> host capability
  -> user setting
  -> product policy
  -> matching action scope
  -> idempotency, rate limit, audit
  -> allow
```

Any failure denies the proposed automatic action or falls back only to an already approved lower-impact action. Product policy defines the ceiling; user settings and host capability may narrow it but cannot expand it. A4, A5, and A6 cannot be derived from one another.

### 8.1 Per-event maximum actions in this proposal

| Event or state | Maximum action under this proposal |
| --- | --- |
| raw `SessionStart` fact | record or interpretation only; not a semantic event |
| `task_started` | task initialization, generic Catalog, or local candidate preparation |
| `change_signal_observed` | record, review, or local candidate preparation |
| `confirmed material scope change` | update constraints and reassess applicability; A4–A6 only under independent scopes |
| `pre_completion_check` | suggest verification or request review; retrieval only under independent scopes |
| `post-hoc completion signal` | audit or retrospective analysis |
| `context_recovery`, identity unknown | record, request review, or generic hint under existing host contract |
| `context_recovery`, same task confirmed | discuss Catalog or local candidate preparation; injection still independently scoped |
| unknown or insufficient | minimal record or abstain |

## 9. Query and audit boundaries

Local candidate-query construction may use event family and version, task boundary, source level, an explicit user requirement summary, a sanitized scope-change summary, recovery cause, inheritance state, and lifecycle stage.

Tool, document, error, verification, path, and short intent summaries are conditional. They must be sanitized and separately authorized before leaving local processing.

Default-prohibited inputs are raw user and tool output, credentials or secrets, environment variables, unredacted file contents, private traces, oracle material, Practice bodies, and unrelated workspace content.

Audit retains only event identity and type/version, timing or ordering basis, host and adapter identity, source and interpretation state, task boundary, action decision, policy and user-setting versions, sanitized evidence reference, and deny, abstain, or degrade reason. Raw traces, oracle material, Practice bodies, credentials, and full tool output remain prohibited. Retention time and visibility are follow-up owner decisions.
## 10. Host capability matrix

This matrix records only integration configuration declarations checked in this repository. No host has real-host behavior or semantic decidability evidence in v0.1. `Pending validation` is the ceiling for every behavior and semantic column until evidence is recorded.

| Host | Event family | Declared raw source | Configuration status | Behavior status | Semantic status | Conservative boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | `task_started` | `SessionStart(startup/resume/clear/compact)` | declared | pending validation | pending validation | startup is only a candidate; resume, clear, and compact are not new-task proof |
| Claude Code | `task_started` | `SessionStart(startup/resume/clear/compact/fork)` | declared | pending validation | pending validation | startup is only a candidate; other causes are not new-task proof |
| Cursor | `task_started` | `sessionStart` | declared | pending validation | pending validation | fire-and-forget output may not be visible before the first turn |
| ZCode | `task_started` | `SessionStart(startup/resume/clear/compact)` | declared | pending validation | pending validation | startup is only a candidate; other causes are not new-task proof |
| WorkBuddy | `task_started` | `SessionStart(startup/resume/clear/compact)` | declared | pending validation | pending validation | startup is only a candidate; other causes are not new-task proof |
| Codex | `scope_changed` | none | no direct semantic entry | pending validation | pending validation | derive only from separately interpreted user, task, or document evidence |
| Claude Code | `scope_changed` | none | no direct semantic entry | pending validation | pending validation | tool or Agent inference cannot become user confirmation |
| Cursor | `scope_changed` | `preToolUse(Shell)` | tool-fact entry declared | pending validation | pending validation | a tool fact is not a scope-change decision |
| ZCode | `scope_changed` | `PreToolUse(Bash)` | tool-fact entry declared | pending validation | pending validation | a tool fact is not a scope-change decision |
| WorkBuddy | `scope_changed` | `PreToolUse(Bash)` | tool-fact entry declared | pending validation | pending validation | a tool fact is not a scope-change decision |
| Codex | `pre_completion_check` | none | no direct entry | pending validation | pending validation | Stop, timers, and file changes are insufficient |
| Claude Code | `pre_completion_check` | none | no direct entry | pending validation | pending validation | an already-published completion is post-hoc |
| Cursor | `pre_completion_check` | none | no direct entry | pending validation | pending validation | sessionStart cannot intercept completion |
| ZCode | `pre_completion_check` | none | no direct entry | pending validation | pending validation | post-tool timing is not pre-publication proof |
| WorkBuddy | `pre_completion_check` | none | no direct entry | pending validation | pending validation | post-tool timing is not pre-publication proof |
| Codex | `context_recovery` | `SessionStart(resume/clear/compact)` | matcher declared | pending validation | pending validation | fork is not declared in the current Codex matcher |
| Claude Code | `context_recovery` | `SessionStart(resume/clear/compact/fork)` | matcher declared | pending validation | pending validation | fork inheritance is separate from compact, resume, and clear |
| Cursor | `context_recovery` | `sessionStart` | event declared | pending validation | pending validation | cause subdivision and visibility are unknown |
| ZCode | `context_recovery` | `SessionStart(resume/clear/compact)` | matcher declared | pending validation | pending validation | task identity fields need real-payload evidence |
| WorkBuddy | `context_recovery` | `SessionStart(resume/clear/compact)` | matcher declared | pending validation | pending validation | task identity fields need real-payload evidence |

`PreToolUse` and `SubagentStart`, where declared, are only host facts. They do not establish task start, scope change, or pre-publication timing.

To promote a cell from `pending validation`, evidence must record the host version, plugin version, CLI version, operating system, trigger method, sanitized payload structure, envelope and output behavior, ordering relative to user, tool, and output events, task-boundary identity, context visibility, malformed-input behavior, timeout or CLI failure behavior, and evidence location or reproduction method. Capability cannot be inferred from another host.

## 11. Benchmark P1 mapping and evidence boundary

| P1 scripted position | Candidate product event | Mapping conclusion |
| --- | --- | --- |
| `task_start` | `task_started` | proves only that the scripted task-start position could deliver under fixed conditions |
| `constraint_followup` | `scope_changed` | proves only that the scripted follow-up position could deliver; it is not recognition evidence |
| `first_implementation_checkpoint` | `pre_completion_check` | a task-script implementation checkpoint is not a universal pre-publication checkpoint |
| none | `context_recovery` / `compaction` | no P1 support |
| none | `post-hoc completion signal` | no P1 support |

Benchmark PR #221 is open. Its public report states that the fixed diagnostic run `pilot-20260926-restart2` delivered the same fixed Practice at three scripted positions and passed the hard evaluator nine times under one fixed task, model, and environment. Judge did not run; there was no no-card or relevant-control condition; no formal record was created; and the original `scratch/` evidence has not been independently audited slot by slot.

`pilot-20260926-restart1` remains the earlier historical run with six completed and three indeterminate slots; its marker-format delivery failures are not backfilled by `restart2`. One separately recorded operator-harness interruption is excluded from the nine-slot statistic. Runtime differences are incidental observations and do not rank timing quality.

This evidence supports only public-report evidence that the three scripted positions were runnable under the stated fixed conditions. It does not support best timing, recognition quality, Practice benefit, automatic-trigger safety, or cross-host generalization.
## 12. Layered evaluation metrics

These are v0.1 metric categories, not frozen sample sets, denominators, weights, or thresholds. Offline recognition evaluation must precede controlled pilots or automatic orchestration.

| Layer | Core question | Candidate metrics |
| --- | --- | --- |
| L1 event recognition | are candidate events interpreted correctly | precision, recall, false-positive rate, false-negative rate, abstention rate, unknown-version rate, missing-task-identity rate, source-level error rate |
| L2 query construction/submission | are queries compliant, useful, and repeatable | allowed-field violation rate, empty-query rate, duplicate-query rate, initial relevance pass rate, submission success and failure rates, policy-deny rate |
| L3 Practice selection | are selected Practices relevant and appropriately ranked | candidate relevance, rank hit rate, false-selection rate, missed-selection rate, post-scope-change reassessment rate, full-read necessity rate |
| L4 delivery | does bounded content reach visible context under the host contract | delivery success rate, latency, visibility confirmation, truncation, degradation, idempotent deduplication |
| L5 user disruption | does automation disturb or damage the task | interruption rate, user-close rate, negative feedback, task interruption, context occupancy, added wait time |
| L6 task outcome | what happens to the final task | task success, verification pass, rework, failure attribution |

Reporting rules:

1. report each layer separately and do not synthesize an unapproved total score;
2. retain failed, indeterminate, abstained, and policy-denied samples in their own denominators;
3. state each denominator, sample source, host, event family, interpretation state, and policy version;
4. L6 supports causal Practice-benefit claims only with an appropriate no-card or relevant-control condition;
5. P1 `restart2` is not a substitute for L1–L6 evaluation.

## 13. Scenario walkthrough

| Scenario | Expected interpretation | Maximum action / degradation |
| --- | --- | --- |
| `SessionStart(resume)` | host fact plus `context_recovery(resume)`; not `task_started` | record; existing generic hint only; do not inherit old judgment |
| `SessionStart(clear)` | user cleared context | record boundary; respect clear semantics; do not restore old scope by default |
| `SessionStart(compact)` | compaction boundary | record; confirm identity before inheritance |
| `SessionStart(fork)` | branched boundary | record; determine new-task and inheritance state separately |
| user explicitly adds required Safari support | `confirmed material scope change` from user instruction | update constraints; A3 locally; A4–A6 only under independent scopes |
| user asks an ordinary performance question | no material scope change | no confirmed event; retain as evaluation signal only if needed |
| tool discovers a risk but user requirements are unchanged | at most `change_signal_observed` | review or local candidate; do not expand approved scope |
| Agent infers a possible architecture preference | weak inference | request review or prepare local candidate; no confirmation |
| applicable authoritative project contract changes | potentially confirmed scope change | update constraints; task identity and action scope still required |
| compaction then same task confirmed | `context_recovery(compact)` with `same_task_confirmed` | discuss Catalog or local candidate; injection remains independent |
| clear or fork with unknown association | inheritance `unknown` | no old-domain restoration or task-specific higher-impact action |
| final content prepared but not sent | `pre_completion_check` candidate | suggest verification; retrieval only under independent scope |
| completion statement already sent | `post-hoc completion signal` | audit or retrospective use only |
| every Stop event | not `pre_completion_check` | no automatic injection |
| unknown event version | incompatible interpretation | record or abstain; do not execute old rules |
| malformed Hook payload or unavailable host path | uninterpreted input | follow existing host degradation; do not fabricate an event |
| authorization policy missing | no action authority | default deny with minimal audit |
| task identity missing | identity `unknown` | no inheritance and no task-specific A4–A6 |

## 14. Open owner decisions

1. whether `change_signal_observed` and `confirmed material scope change` become separate public event names;
2. the first controlled-pilot host short list;
3. which independent issue owns real-host behavior validation and its accepted evidence repository;
4. which independent issue pre-registers offline samples, denominators, thresholds, and label arbitration;
5. whether original P1 `scratch/` auditing is a final acceptance gate for this design;
6. the approval and versioning process for A1-A6 product policies, user settings, and independent scopes;
7. retention time, visibility, and sanitization review rules for event and decision audit records;
8. the conditions under which authoritative documents may confirm task scope without a separate user instruction.

## 15. References

- [ADR 0017: Practice lifecycle event contract ownership](../adr/0017-practice-lifecycle-event-contract.md)
- [Agent integration capability contract](../../openspec/specs/agent-integration/spec.md)
- [Product issue #268](https://github.com/lorelum/lorelum/issues/268)
- [Product research issue #28](https://github.com/lorelum/lorelum/issues/28)
- [Benchmark issue #201](https://github.com/lorelum/lorelum-benchmark/issues/201)
- [Benchmark PR #221](https://github.com/lorelum/lorelum-benchmark/pull/221)
