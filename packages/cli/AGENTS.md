# AGENTS.md — packages/cli

`@lorelum/cli` owns command protocol, execution-route selection, and worktree verification.

## Ownership and routing

The CLI is the composition and protocol boundary. It parses commands, resolves global options, selects the execution route, and renders stable JSON envelopes. It may depend on Engine and Backend; Engine and Backend must not depend on CLI.

- Keep command parsing, envelope/schema rendering, and user-facing error mapping thin. Business retrieval, Store, index, and ranking rules remain in Engine; runtime/model lifecycle remains in Backend.
- Every LocalStore-consuming command must use the shared Store-root resolver. Do not call `defaultStorageRoot` directly when honoring `--store-root`.
- Keyword query stays `CLI → Engine` so it remains offline. Semantic query and semantic-index operations use `CLI → Backend client → Backend daemon → Engine use case`; do not create `CLI → Engine → Backend client` routing.
- Preserve command-definition schemas, exit-code semantics, and the complete `--json` envelope. Ordinary commands default to complete text; use `--json` for a machine consumer. Do not make a lifecycle state such as `preparing` look like a successful retrieval result or silently substitute keyword results for semantic behavior.

## Current-worktree verification

- Run source-level CLI checks from this worktree with `bun packages/cli/src/main.ts ...`. Do not validate source changes with global `lore`, a binary from another worktree, or by editing a developer's shell configuration to recover `lore-dev`.
- Pass an explicitly isolated `--store-root` for any worktree validation that can open a Store, including reads and queries. Omit it only when the task explicitly requires the developer's shared Store.
- `backend start/status/stop` and keyword checks do not require a native candidate. Before source validation that can embed, run `bun run build:native`.
- Choose compiled checks by purpose: `bun run build:cli` for non-embedding behavior, `bun run build:release-staging` for a runnable embedding candidate, and `bun run build:release` only for final archive validation.
- A missing model or index follows the current lifecycle contract: query may return `data.state: "preparing"`; index operations may be accepted as `preparing` or `building`; Pack mutation must not be rolled back because a derived index is pending or failed. Use [the development guide](../../docs/development/README.md) for the full workflow rather than duplicating lifecycle detail here.

## Verification

- Add colocated command, schema, and error-mapping tests for changed behavior. Run focused tests, then `bun test packages/cli` for package-wide changes.
- Run `bun packages/cli/integration/process.integration.ts` only when the change and available runtime candidate require process-level validation. Keep integration Stores isolated.
- Update the corresponding [CLI documentation](../../docs/cli/README.md) when a current command contract changes; plans and tests alone are not public API documentation.

## Canonical references

- [Development guide](../../docs/development/README.md)
- [CLI command index](../../docs/cli/README.md)
- [Backend command contract](../../docs/cli/backend.md)
- [Query contract](../../docs/cli/query.md)
