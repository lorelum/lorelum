# Semantic query recovery in Codex

Read this reference only after a semantic `lore query ...` has reported `state: "preparing"` or an error. Do not use it as a preflight checklist before the first query. Default text is sufficient to detect that recovery is needed; rerun the query with `--json` only when diagnosing exact envelope fields. The injected Pack Catalog remains available while recovery is in progress; do not rerun `lore pack list --details` unless the catalog itself is missing or truncated.

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
  - `automation: "auto"`: run `lore backend stop --if-idle --json`. If its data state is `stopped`, retry the original query immediately. If it returns `deferred`, treat it as the defer path below.
  - `automation: "defer"`: leave the other Backend running, keep the current task moving, and retry the original query in the background with bounded backoff. Do not kill, stop, or prompt the user about the other task.
- Before a host Agent starts a Lorelum-dependent long task, acquire a machine lease with `lore backend lease acquire`; retain its opaque `leaseId`, renew it before the returned expiry with `lore backend lease renew <leaseId>`, and release it in a `finally` path with `lore backend lease release <leaseId>`. This is host automation, not a user-facing setup step. If a lease cannot be maintained, do not attempt automatic Backend handoff.
- For other `backend.*` errors, inspect the documented startup, port, or configuration condition before retrying.
- For `store.busy` or `store.recovery-required`, do not treat the failure as an empty result. Wait for concurrent work to finish or recover the selected Store, then retry the same query.

## Keyword mode remains explicit

Do not use keyword retrieval as an automatic fallback. Use it only when the user intentionally wants offline lexical lookup or when diagnosing the semantic runtime, and identify the result as keyword retrieval. Use concise concrete terms rather than a full natural-language request:

```sh
lore query "idempotency key database uniqueness safe retry" --mode keyword
```
