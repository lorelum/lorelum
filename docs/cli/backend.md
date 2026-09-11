# Control the local backend

`lore backend start`, `lore backend status`, and `lore backend stop` manage the local Lorelum backend. The backend listens only on `127.0.0.1:26186`; these commands use its private local control protocol rather than a public network API.

```sh
lore backend start
lore backend status
lore model load
lore model status
lore model unload
lore backend stop
lore describe backend.start
```

`start` waits until one authenticated backend instance reports `ready`. It is safe to repeat while that same compatible instance is already running. `status` has no start or model-loading side effect. `stop` asks the verified instance to exit and waits for the result. A command exits with `0` only after the requested state has been observed.

The successful protocol envelope contains one of these status values:

```json
{
  "state": "ready",
  "model": "unloaded",
  "instanceId": "...",
  "buildIdentity": "..."
}
```

`instanceId` and `buildIdentity` are included when an instance exists. `model` reports the resident embedding service separately from backend lifecycle state. `lore model load` and `lore model unload` require an already running backend; `lore model status` is read-only and none of the model commands starts the backend. These commands do not read a LocalStore, so the global `--store-root` option has no effect on them.

## Configuration

The optional file `~/.lorelum/config.yaml` is shared by Lorelum modules. Its `backend` section accepts these settings in milliseconds:

```yaml
backend:
  startupTimeoutMs: 10000
  requestTimeoutMs: 5000
  shutdownTimeoutMs: 5000

embedding:
  modelPath: /absolute/path/to/granite-q4_0.gguf
```

The backend timeout values shown above are also the defaults. Each timeout must be an integer from 1 to 120000. There is no default model path. Environment variables override individual file values:

| Setting                   | Environment variable                  |
| ------------------------- | ------------------------------------- |
| Startup timeout           | `LORELUM_BACKEND_STARTUP_TIMEOUT_MS`  |
| Control request timeout   | `LORELUM_BACKEND_REQUEST_TIMEOUT_MS`  |
| Graceful shutdown timeout | `LORELUM_BACKEND_SHUTDOWN_TIMEOUT_MS` |

Each control invocation reads the configuration. The running daemon keeps its startup settings until it is stopped and restarted; repeated `start` does not reload them. Invalid YAML, unknown keys within `backend`, and invalid backend values fail with `backend.config-invalid`, even if another source overrides the invalid value. A missing or empty file uses defaults and is not created automatically. Other top-level sections remain available to their owning modules. The former experimental `backend.json` is no longer read; move its values under `backend` in `config.yaml`.

The embedding section is optional. `modelPath` must be an absolute path; unknown embedding keys and serialized embedding snapshots over 2048 UTF-8 bytes are rejected. The listening address remains fixed. The runtime directory and private launch handshake are separate from this user configuration.

## Errors and exit codes

Failures return the standard CLI envelope with exit code `2`. Callers should branch on `error.code`, not its message.

| Code                        | Meaning                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `backend.unavailable`       | No verified local backend is running.                              |
| `backend.port-conflict`     | The configured address belongs to an unverified process.           |
| `backend.incompatible`      | The running backend has an incompatible build or protocol.         |
| `backend.unauthorized`      | The control handshake failed.                                      |
| `backend.invalid-request`   | The local control request was invalid.                             |
| `backend.busy`              | The backend is starting, stopping, or cannot accept this request.  |
| `backend.deadline-exceeded` | The backend did not reach the requested state in time.             |
| `backend.config-invalid`    | The backend configuration is invalid.                              |
| `backend.state-invalid`     | Local lifecycle state cannot be safely recovered.                  |
| `backend.failed`            | The backend operation failed without a more specific public cause. |

Model commands may also return `embedding.not-configured`, `embedding.resource-invalid`, `embedding.not-loaded`, `embedding.busy`, `embedding.input-invalid`, `embedding.input-too-long`, `embedding.deadline-exceeded`, or `embedding.failed`.

Backend lifecycle requests contain no Store paths or query text; the client authenticates using the private runtime credential. They neither start a model runtime nor change query behavior.

## Implementation scope

This stage provides a resident keyword-query endpoint, process control, and explicit embedding-model lifecycle commands. Existing CLI query commands still execute through their original Engine path; reducing full CLI startup cost is separate work. The embedding artifact currently targets macOS arm64 only. Windows native artifacts, process identity/private ACL support, and end-to-end acceptance remain pending; Linux embedding is outside this stage. Unsupported embedding platforms fail explicitly rather than launching an unverified executable.

## Build and upgrade

Build the native package with `bun scripts/native/build-embedding.ts`, then build the CLI with `bun run build:cli`. Keep `dist/lore` next to the complete `dist/native/darwin-arm64/` directory, including its manifest and license notices. Native resources are verified against the artifact pinned in the CLI; rebuilding with a different toolchain requires reviewing and repinning that artifact. Models are not downloaded automatically.

This change uses control/business protocol version 2. Before upgrading, use the **old CLI** to stop the old daemon; then install the new CLI/native resources and start the backend again. A new client rejects an old control protocol and cannot be assumed to stop it.

After loading, authenticated backend clients can encode one to eight texts through `/internal/v1/embeddings`. Each input may contain at most 512 tokens including special tokens. Inputs are preserved, overlong text is rejected, and a concurrent encoding request returns busy. Query and document currently share the fixed 384-dimensional CLS/L2 encoding. Semantic index/query adoption remains a later stage.
