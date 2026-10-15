# Diagnostic and semantic query recovery

Read this reference only after either an original Lorelum failure has a `diagnostics.traceId`, or a semantic `lore query ...` has reported `state: "preparing"` or an error. Do not use it as a preflight checklist before the first query. Default text is sufficient to detect that recovery is needed; use `--json` only when exact protocol fields are required. Reuse any Pack Catalog already visible in the task. An omp child normally has no Catalog; do not automatically run `lore pack list --details` to fill that absence or bootstrap a directory during recovery. Independent Pack discovery is allowed only when the assigned task materially needs it.

## Original trace evidence

First inspect only the original trace:

```sh
lore logs --trace-id <traceId>
```

Report verifiable records, including normal local context already present in the original trace, and `missingEvidence`. Do not scan another trace, an arbitrary directory, or fetch new environment/configuration, HTTP, or native content merely to enrich this evidence. Do not preflight Backend, model, index, or status before this trace read, and do not rerun merely to obtain more detail. If the original failure has no trace, state that limit rather than manufacturing one. For a non-query command, follow its visible error recovery after this bounded observation.

## Controlled reproduction and local feedback

If the current trace remains insufficient, explain the evidence limit. Run `lore --debug <command>` only when the user explicitly asks for reproduction/diagnosis or the task already authorizes a safe minimal reproduction; its trace is a new invocation, not evidence from the original failure.

When the original trace establishes a Lorelum bug or missing feature during a long-running user task, keep the task moving. At completion or another safe stopping point, ask whether the user wants a local feedback draft; do not interrupt the task or create one automatically.

Only after the user explicitly agrees to prepare a local draft, run:

```sh
lore feedback draft --trace-id <traceId> --kind <bug|improvement>
```

The default draft contains the complete retained same-trace `error`, `warn`, and `info` call chain, including normal context, correlation IDs, and recorded Error stacks. `--include-logs info` is equivalent to the default; use `--include-logs debug` only to add debug records that were already written. If no debug record exists, report `debug-records-not-found`; a new debug reproduction is a new trace, not recovered evidence.

Show the artifact paths, included evidence classes, `externalReview`, and `missingEvidence`. A draft is local only, not a submission, upload, public Issue, triage result, or authorization to change product behavior. Uploading logs or creating/updating an Issue requires a separate explicit authorization for that external action. Ordinary local query, result, path, native output, and Error-stack evidence do not need an extra privacy prompt; ask for a review or propose private support only if the material actually contains credential-like or clearly sensitive content. If the user declines or does not respond, do not create a draft or repeat the offer in the task. SessionStart and recoverable Hook paths remain metadata-only and never create feedback artifacts.

## Model preparation or embedding errors

- For `data.state: "preparing"`, run `lore model status --json` and retry the same query after the model is ready.
- If a previous model download or load failed, or waiting is necessary, run `lore model load --json` to retry and wait.
- For an `embedding.*` error, inspect `lore model status --json`, resolve the reported configuration or resource problem, then use `lore model load --json` before retrying the same query.

## Semantic index errors

- For `semantic.index-not-ready`, run `lore index build --json`.
- For an incompatible or failed semantic index, run `lore index rebuild --json`.
- If either command returns an operation ID, inspect it with `lore index operation <operation-id> --json` until it is ready, then retry the same query.

## Backend or Store errors

- For `backend.build-mismatch` or `backend.protocol-mismatch`, read `error.recovery`; do not inspect `backend status`, ask the user whether to stop, or run ordinary `lore backend stop`.
  - `automation: "auto"`: run `lore backend stop --if-idle --json`. If its data state is `stopped`, retry the original query immediately. If it returns `deferred`, follow the defer path.
  - `automation: "defer"`: leave the other Backend running, keep the current task moving, and retry the original query in the background with bounded backoff. Do not kill, stop, or prompt the user about the other task.
- For other `backend.*` errors, inspect the reported startup, port, or configuration condition before retrying.
- For `store.busy` or `store.recovery-required`, do not treat the failure as an empty result. Wait for concurrent work to finish or recover the selected Store, then retry the same query.

## Keyword mode remains explicit

Do not use keyword retrieval as an automatic fallback. Use it only when the user intentionally wants offline lexical lookup or when diagnosing the semantic runtime, and identify the result as keyword retrieval. Use concise concrete terms rather than a full natural-language request:

```sh
lore query "idempotency key database uniqueness safe retry" --mode keyword
```
