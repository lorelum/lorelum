# Lorelum for Pi

This is the first-party Pi Package for Lorelum. It ships a Pi Extension and a Pi Skill from one source root, `plugins/pi/lorelum/`, and installs through Pi's native local Package mechanism. The current host integration contract is [agent-integration](../../../openspec/specs/agent-integration/spec.md); this README explains the Pi-specific distribution and operating model for maintainers.

The Extension reads a bounded **Installed Pack Catalog** from the released `lore` CLI at Pi lifecycle boundaries and projects it into the next model request. The bundled Skill uses that Catalog as a relevance hint — never as the full engineering rules or a hard filter — and makes one targeted semantic query at a material decision before reading each Practice in full. The Extension never calls `lore query` or `lore get`, installs Packs, downloads models, or starts the Backend. Agent-initiated Skill retrieval uses the ordinary CLI lifecycle.

## Package layout

Pi loads only the resources the package manifest names, so helper modules and tests cannot be discovered as standalone Extensions.

| Path | Role |
| --- | --- |
| `package.json` | Pi manifest: product name `lorelum`, explicit `pi.extensions` and `pi.skills`. |
| `extensions/lorelum.ts` | The single Extension entry point; registers lifecycle handlers only. |
| `extensions/cli-catalog.ts` | Node process adapter that runs `lore hook pi` with a stdin JSON payload. |
| `skills/lorelum/SKILL.md` | The `lorelum` Skill and its `/skill:lorelum` explicit entry. |
| `scripts/` | Colocated configuration and guidance tests. |
| `test/runtime/` | Real Pi runtime, controlled provider, and executable stdin fixture. |

`package.json` declares the host package `@earendil-works/pi-coding-agent` as a type-only `peerDependencies` entry with a `"*"` range and does not bundle it. The Package has no runtime dependencies; it calls the released CLI through `PATH`.

## Lifecycle behavior

The Extension registers four handlers and starts no process, timer, or watcher in the factory:

- `session_start` and a successful `session_compact` clear the previous snapshot and request a fresh Catalog from `lore hook pi`. The `context` event never runs the CLI.
- `context` removes any prior projection it owns and prepends exactly one `role: custom`, `customType: lorelum:pack-catalog`, `display: false` message. It does not persist the message, take over the system prompt or tools, or add a turn.
- `session_shutdown` aborts an in-flight call and clears the snapshot. Cleanup is idempotent because cancellation, reload, session replacement, and exit can converge on it.

Pack metadata is carried in a flat `{ "additionalContext": "<Catalog>" }` envelope. This is the **Lorelum Extension/CLI adapter contract**, not a Pi shell Hook response schema: the Extension parses it and projects it through the Pi API. The CLI owns the shared Catalog renderer and its 4000-character budget; see [`docs/cli/hook.md`](../../../docs/cli/hook.md).

Each `lore hook pi` call is `lore hook pi` on `PATH`, with the payload on stdin and a 5000 ms deadline, a 16 KiB stdout retention cap, and an 8 KiB stderr retention cap. On Windows the adapter prefers a directly executable `lore`; only when that executable is missing does it fall back to the installer's `lore.cmd` through a fixed `cmd.exe` invocation and terminate the whole shim process tree. A non-zero exit or Store failure never triggers the fallback or a retry.

## Failure boundary

The process adapter returns a discriminated unavailable outcome for missing/unsupported CLI, execution failure, timeout, cancellation and invalid responses. A successful empty Catalog remains distinct from these failures. The lifecycle clears its old snapshot before each refresh and never re-injects stale metadata after failure. Interactive notifications distinguish installation/update from CLI/Store diagnosis; non-interactive protocol stdout is untouched. Cancellation during shutdown or supersession does not notify.

## Local validation

From the repository root:

```sh
bun test plugins/scripts plugins/pi/lorelum
bun run typecheck
```

To smoke-check the source CLI without installing it, pipe a lifecycle payload through the source entrypoint against an isolated Store root:

```sh
printf '%s\n' '{"hook_event_name":"session_start"}' | bun packages/cli/src/main.ts hook pi --store-root /tmp/lore-pi-e2e-store
```

The runtime suite uses Pi's real `createAgentSession` / `createAgentSessionRuntime`, a controlled faux provider, and the production Extension/process adapter. A separate `context` observer classifies conversation requests independently of the Catalog being asserted. Conversation requests must contain exactly one Catalog; summarization requests must contain none. Coverage includes manual and automatic threshold compaction, overflow's internal compact-and-retry without another user turn, transient retry, cancelled/failed compaction, and session replacement.

### Verified candidate

Implementation acceptance used Linux x64, Bun 1.4.3, Node 24.21.0, and Pi / pi-ai 1.2.0:

- `bun test packages/cli plugins scripts/ci/typecheck.test.ts`: **584 pass, 3 platform skips, 0 fail**. The skipped cases require Windows/PowerShell.
- `bun run lint`, `bun run fmt:check`, `bun run typecheck`, and `bun run --filter @lorelum/site build`: passed. Lint retains four existing warnings outside this integration.
- `bun run build:cli`: produced the complete `dist/release/linux-x64/` candidate with its matching native runtime, not a CLI-only binary.
- A temporary HOME, explicit isolated Store root, and PATH launcher selected that candidate without modifying the user's CLI, Store, Pi settings, or credentials. A valid local Pack was installed using `lore pack install --path`. Its first semantic query returned `preparing`; after model preparation, a complete semantic query and `get` retrieved `pi.validation.api-boundary` and its full body using the actual native model.
- Actual `pi install` in personal scope and project scope (explicit approval of the disposable project) loaded one Extension and Skill even with both scopes configured. The installed Package's `/skill:lorelum` expanded through Pi's SDK; real Bash tools ran the compiled semantic query and `get`. All three conversation requests contained one non-persisted Catalog.
- Removing the temporary CLI from PATH, substituting an unsupported CLI, and selecting a failing Store all left requests usable without stale Catalogs. An empty Store returned an explicit empty Catalog. Restoring the candidate and using Pi's real reload recovered the snapshot.
- Local Package update and removal from both scopes succeeded; subsequent resource discovery found no Lorelum resources, while the CLI and installed Pack remained usable. The isolated Backend was stopped after verification.
- The Windows missing-shim regression fails with the pre-fix fallback classification and passes with the fix; a real CLI exit 1 remains distinct from a missing shim.

These checks do **not** establish native Windows/macOS execution, a live interactive TUI trust/notification flow, or an external model's autonomous Skill-selection quality. Host lifecycle and Skill expansion ran through the real SDK with a controlled provider; semantic retrieval used the real model/runtime. Windows shim, timeout, cancellation, and process-tree behavior also have deterministic process-adapter coverage.

User-facing install, trust, update, and removal instructions belong to the bilingual [Pi site guide](../../../apps/site/content/docs/pi.mdx); this file is maintainer material only.
