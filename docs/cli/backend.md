# Control the local backend

`lore backend start`, `lore backend status`, and `lore backend stop` manage the local Lorelum backend. The backend listens only on `127.0.0.1:26186`; these commands use its private local control protocol rather than a public network API.

```sh
lore backend start
lore backend status
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

`instanceId` and `buildIdentity` are included when an instance exists. The first backend stage always reports `model: "unloaded"`; loading an embedding model is a later stage. These commands do not read a LocalStore, so the global `--store-root` option has no effect on them.

## Configuration

The optional file `~/.lorelum/config.yaml` is shared by Lorelum modules. Its `backend` section accepts these settings in milliseconds:

```yaml
backend:
  startupTimeoutMs: 10000
  requestTimeoutMs: 5000
  shutdownTimeoutMs: 5000
```

These are also the defaults. Each value must be an integer from 1 to 120000. Environment variables override individual file values:

| Setting                   | Environment variable                  |
| ------------------------- | ------------------------------------- |
| Startup timeout           | `LORELUM_BACKEND_STARTUP_TIMEOUT_MS`  |
| Control request timeout   | `LORELUM_BACKEND_REQUEST_TIMEOUT_MS`  |
| Graceful shutdown timeout | `LORELUM_BACKEND_SHUTDOWN_TIMEOUT_MS` |

Each control invocation reads the configuration. The running daemon keeps its startup settings until it is stopped and restarted; repeated `start` does not reload them. Invalid YAML, unknown keys within `backend`, and invalid backend values fail with `backend.config-invalid`, even if another source overrides the invalid value. A missing or empty file uses defaults and is not created automatically. Other top-level sections remain available to their owning modules. The former experimental `backend.json` is no longer read; move its values under `backend` in `config.yaml`.

The listening address remains fixed. The runtime directory and private launch handshake are separate from this user configuration.

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

Control requests contain no Store paths or query text; the client authenticates using the private runtime credential. They neither start a model runtime nor change query behavior.

## Implementation scope

This stage provides a resident keyword-query endpoint and process control. Existing CLI commands still execute through their original Engine path; reducing full CLI startup cost is separate work. No model is loaded. The process supervisor currently targets macOS/Linux; other platforms are not verified.
