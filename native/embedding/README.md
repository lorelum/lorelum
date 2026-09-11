# Embedding native runtime

This directory pins the source and patch used to build Lorelum's CPU-only `llama-server`. The build output is platform-specific and remains under the ignored `dist/native/<platform>-<arch>/` directory.

The server's standard input is a parent-liveness pipe. Its independent watcher starts before llama.cpp parses arguments or loads a model. Closing the daemon's write end makes the server call `_Exit`, including when normal inference cleanup cannot make progress. No other component may consume the server's stdin.

Build and validate the macOS arm64 artifact:

```sh
bun scripts/native/build-embedding.ts
bun scripts/native/test-parent-liveness.ts --mode startup
bun scripts/native/test-parent-liveness.ts --mode encoding
bun scripts/native/test-parent-liveness.ts --mode stalled-main
```

The build script verifies the pinned source archive and patch, downloads and verifies a pinned CMake distribution (reusing the local cache when available), disables GPU backends and shared llama.cpp libraries, and writes a hash manifest beside the executable and license notices.

The checked-in `artifacts/darwin-arm64.json` is the trusted manifest compiled into the backend. A build writes its candidate manifest to `dist`, and never silently updates that trust anchor. When the toolchain or recipe changes, review the complete candidate, run the native and backend integration checks, and explicitly replace the trusted manifest before compiling the CLI. A changed digest is rejected at model load.

The CPU target is an M1-compatible ARMv8.4/FP16/dot-product baseline, with no i8mm and no compiled GPU backend. It is verified on M4, not yet on every Apple Silicon device. Windows artifacts and private process/file support remain pending.

Run the backend acceptance separately after the native build:

```sh
bun packages/backend/integration/embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/daemon-embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
```

The first script optionally accepts a second argument pointing to the preserved validation reference directory; this also checks frozen tokenizer and Q4 vectors. It performs no model download. The second uses an isolated runtime directory and verifies process reuse, timeout/crash recovery, parent death, and clean daemon restart.

For the four integration entrypoints, scenario boundaries, optional frozen references, and the distinction between acceptance and performance observations, see the [backend integration guide](../../docs/development/backend-integration.md).
