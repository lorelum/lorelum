# AGENTS.md — packages/backend

`@lorelum/backend` owns local runtime hosting, protocol adapters, and lifecycle verification.

## Ownership and dependency boundary

`@lorelum/backend` is the local, long-lived host for cold-start-expensive capabilities. It owns model download/load/unload, daemon and child-process lifecycle, loopback authentication, runtime readiness, and the execution lifetime of Backend-hosted Engine use cases.

- Backend may depend on Engine and compose Engine services with in-process runtime adapters. Engine must not depend on Backend.
- Controllers are adapters over Engine use cases. Define Engine contracts and error semantics first; keep HTTP DTO/controller code in `src/modules/<feature>/` and do not reimplement Store, index, ranking, or retrieval semantics in controllers.
- Keep model configuration and runtime state user-scoped. `--store-root` selects canonical Pack/index data only; it does not select model configuration, model cache, backend address, or runtime directories.
- Preserve loopback-only control and query boundaries. Do not broaden the network surface, weaken authentication, or introduce local MCP as a Backend convenience path.

## Runtime and lifecycle work

- Keep daemon supervision, startup locks, child-process identity, cleanup, cancellation, and deadline behavior in the runtime/coordination layers that own them.
- Separate model preparation from query/index business operations. A model may prepare in the background, but Engine staging, Store mutation locks, snapshots, and index writer locks must not be held while waiting for a download or runtime startup.
- Lifecycle states and typed protocol errors must remain observable. Do not report an unavailable runtime as a ready query, and do not turn a runtime error into an empty retrieval result.
- Keep platform-specific native artifact handling under `src/runtime/native/` and use the existing integration support rather than adding ad hoc process management in a feature controller.

## Verification

- Add colocated unit/protocol tests for lifecycle and adapter behavior. Run focused tests, then `bun test packages/backend` when the package-wide scope is affected.
- For CLI acceptance against the shared Backend, follow the [normal worktree workflow](../../docs/development/README.md#normal-development-workflow) and select the target build with `backend start --current-build`; a successful ordinary query may still use another build's Backend. Integration harnesses that already launch their own isolated daemon do not need to switch the shared service.
- Backend/model lifecycle and keyword behavior do not require a native candidate. Before source validation that exercises embedding, model preparation, or semantic indexing, run `bun run build:native`.
- Run the relevant scripts in `packages/backend/integration/` only with the required local native/model inputs and isolated test paths. They are integration acceptance, not ordinary unit tests.
- Record readiness, preparing, failure, cancellation, and cleanup observations separately; a passing mocked unit test does not establish native-process behavior.

## Canonical references

- [Backend API](../../docs/api/backend.md)
- [Embedding API](../../docs/api/embedding.md)
- [Backend CLI contract](../../docs/cli/backend.md)
- [Backend development integration](../../docs/development/backend-integration.md)
