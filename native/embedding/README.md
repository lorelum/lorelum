# Embedding native runtime

This directory pins the source and patch used to build Lorelum's CPU-only model runtime from upstream `llama-server`. The platform-specific development candidate exposes it as `lore-model` under the ignored `packages/backend/.artifacts/native/embedding/<target>/` directory. `dist/` is reserved for release staging and archives.

The server's standard input is a parent-liveness pipe, active only when the spawner sets `LLAMA_PARENT_LIVENESS_STDIN=1`. The daemon passes that opt-in, and the independent watcher starts before llama.cpp parses arguments or loads a model. Closing the daemon's write end makes the server call `_Exit`, including when normal inference cleanup cannot make progress. Without the opt-in the server behaves like a standard llama-server invocation and its stdin is not observed. No other component may consume the server's stdin.

The `stalled-main` probe needs the patched llama.cpp source and prepares it in the invoking worktree's `.cache/native-build/` when necessary. It does not rebuild `llama-server` or alter the shared completed-runtime cache.

Build and validate the host's CPU artifact (macOS arm64, Linux x64, Windows x64):

```sh
bun run build:native
bun scripts/native/test-parent-liveness.ts --mode startup
bun scripts/native/test-parent-liveness.ts --mode encoding
bun scripts/native/test-parent-liveness.ts --mode stalled-main
bun scripts/native/test-parent-liveness.ts --mode direct-version
```

The `direct-version` mode runs without the opt-in and asserts that a direct invocation is not affected by stdin EOF; it is the regression check for the silent-exit defect fixed by the opt-in gate.

Linux builds use the distribution's `cmake` and `c++` (no pinned CMake download); the cache key fingerprints the system CMake, compiler, and glibc versions in place of the macOS SDK. The recipe disables OpenMP so the binary links only the system runtime (`libc`, `libstdc++`, `libm`, `libgcc_s`) and stays portable across distributions with a compatible glibc.

Windows builds download the pinned CMake win64 zip and the pinned WinLibs MinGW-w64 GCC (UCRT, x86_64-posix-seh) into this worktree's `.cache/native-build/tools/`; no system install or PATH change is required. Extraction and patching run through `System32\tar.exe` (bsdtar) and `git apply` because GNU tar treats `D:\...` as `host:path` and Windows has no `patch`. The recipe keeps the Linux-style generic x64 CPU baseline (no AVX2/AVX-512), adds `-D_WIN32_WINNT=0x0A00` for cpp-httplib's `CreateFile2`, and links `-static` so the distributed `lore-model.exe` depends only on system DLLs (`kernel32`, `ws2_32`, `advapi32`, `shell32`, and the UCRT API sets). The cache key fingerprints the pinned toolchain digests plus the Windows build number.

`build:native` keeps downloaded source, CMake, and CMake intermediates in this worktree's ignored `.cache/native-build/`. Its completed runtime is shared through the operating system cache: on macOS, `~/Library/Caches/Lorelum/native/v1`; on Linux, `$XDG_CACHE_HOME/lorelum/native/v1` or `~/.cache/lorelum/native/v1`; on Windows, `%LOCALAPPDATA%\Lorelum\Cache\native\v1`. The first matching build creates a verified cache entry. A later worktree with the same recipe and compiler/SDK fingerprint copies that entry into its own `.artifacts` candidate without downloading or starting CMake. Delete the system cache root to force a rebuild.

The checked-in `packages/backend/src/runtime/native/embedding/darwin-arm64.json`, `linux-x64.json`, and `win32-x64.json` are the reviewed source recipes and the manifests compiled into a release CLI. A source backend accepts a locally built candidate only when its target, recipe fields, model identity, file hashes, executable mode, and dynamic dependencies validate; its `buildIdentity` may differ because the local compiler produced different bytes. A compiled release requires the on-disk manifest to match the manifest compiled into that CLI exactly. A build never silently updates the checked-in trust anchor.

Changing the recipe (patch, source, model, or CMake flags) updates a trust anchor in two phases:

1. **Before building**, update the recipe inputs in `native/embedding/build-config.json` (for example the patch file together with its `patch.sha256`), then update the recipe-identity fields of every target manifest: `patchSha256`, `recipeIdentity`, and `cmakeFlags`. `cmakeFlags` stores the resolved flags, and the `@BUILD_COMMIT@` substitution embeds the first eight characters of the patch digest, so a patch change also moves bytes inside `cmakeFlags`. `recipeIdentity` is the `stableSha256` of `{schemaVersion, source, patchSha256, cmakeFlags, model}`. `bun run build:native` validates each freshly built candidate against these fields and fails with "native artifact manifest differs from the current source recipe" when the anchor lags behind, so the anchor must lead the build.
2. **After building and validating the candidate** (parent-liveness modes, backend checks), copy the freshly written `packages/backend/.artifacts/native/embedding/<target>/manifest.json` over the built platform's checked-in manifest to record its real `files` hashes and `buildIdentity`. Platforms you did not build keep their last verified file hashes until their own rebuild refreshes them; their phase-1 identity fields already match the new recipe, so source development on those platforms keeps validating.

The macOS CPU target is an M1-compatible ARMv8.4/FP16/dot-product baseline, with no i8mm and no compiled GPU backend. It is verified on M4, not yet on every Apple Silicon device. The Linux x64 CPU target is the generic x86-64 baseline: `GGML_NATIVE` plus `GGML_SSE42/AVX/AVX2/BMI2/FMA/F16C` and `GGML_OPENMP` are all off, so no AVX2/AVX-512 capability is required; the fast CPU variants remain future work. It was built and verified on Ubuntu 24.04 (glibc 2.39) under WSL2, which does not by itself certify every Linux distribution. The Windows x64 target shares that generic baseline with a static MinGW runtime; its artifact was rebuilt and verified end to end on Windows 11 x64 (pack install, model load, semantic index, and semantic query) when the parent-liveness opt-in gate landed.

Run the backend acceptance separately after the native build:

```sh
bun packages/backend/integration/embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/daemon-embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
```

The first script optionally accepts a second argument pointing to the preserved validation reference directory; this also checks frozen tokenizer and Q4 vectors. It performs no model download. The second uses an isolated runtime directory and verifies process reuse, timeout/crash recovery, parent death, and clean daemon restart.

For the four integration entrypoints, scenario boundaries, optional frozen references, and the distinction between acceptance and performance observations, see the [backend integration guide](../../docs/development/backend-integration.md).
