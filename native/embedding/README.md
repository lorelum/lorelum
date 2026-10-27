# Embedding native runtime

This directory pins the source and Lorelum runtime patch used to build Lorelum's CPU-only model runtime from upstream `llama-server`. The platform-specific development candidate exposes it as `lore-model` under the ignored `packages/backend/.artifacts/native/embedding/<target>/` directory. `dist/` is reserved for release staging and archives.

The runtime patch also keeps the x86 repack GEMV/GEMM lookup-table argument at 128 bits and broadcasts it inside the AVX helper. Its two 128-bit halves were identical. With the pinned MinGW GCC 15.2.0, passing it as `__m256i` generated a 32-byte aligned stack store in a caller that only maintained 16-byte alignment, causing an access violation during multi-threaded inference on the validated Windows host. This retains AVX2 and the configured thread count; it preserves launch parameters and quantization arithmetic.

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

Windows builds download the pinned CMake win64 zip and the pinned WinLibs MinGW-w64 GCC (UCRT, x86_64-posix-seh) into this worktree's `.cache/native-build/tools/`; no system install or PATH change is required. Extraction and patching run through `System32\tar.exe` (bsdtar) and `git apply` because GNU tar treats `D:\...` as `host:path` and Windows has no `patch`. The recipe keeps the Linux-style AVX2 x64 CPU baseline (no AVX-512 or AVX-VNNI), adds `-D_WIN32_WINNT=0x0A00` for cpp-httplib's `CreateFile2`, and links `-static` so the distributed `lore-model.exe` depends only on system DLLs (`kernel32`, `ws2_32`, `advapi32`, `shell32`, and the UCRT API sets). The cache key fingerprints the pinned toolchain digests plus the Windows build number.

`build:native` keeps downloaded source, CMake, and CMake intermediates in this worktree's ignored `.cache/native-build/`. Its completed runtime is shared through the operating system cache: on macOS, `~/Library/Caches/Lorelum/native/v1`; on Linux, `$XDG_CACHE_HOME/lorelum/native/v1` or `~/.cache/lorelum/native/v1`; on Windows, `%LOCALAPPDATA%\Lorelum\Cache\native\v1`. The first matching build creates a verified cache entry. A later worktree with the same recipe and compiler/SDK fingerprint copies that entry into its own `.artifacts` candidate without downloading or starting CMake. Delete the system cache root to force a rebuild.

Within a native-build invocation, a verified download's digest is reused until new bytes are downloaded, and the recipe identity is computed once for both the cache key and manifest. The patch is verified and captured before cache lookup; source materialization applies those exact bytes through stdin rather than rereading the patch.

The checked-in `packages/backend/src/runtime/native/embedding/darwin-arm64.json`, `linux-x64.json`, and `win32-x64.json` are the reviewed source recipes and the manifests compiled into a release CLI. Source preparation accepts a locally built candidate only when its target, recipe fields, model identity and executable validate; its `buildIdentity` may differ because the local compiler produced different bytes. A compiled release requires the on-disk manifest to match the manifest compiled into that CLI exactly. Full build/package validation also checks the complete file set, licenses/notices and dynamic dependencies. A build never silently updates the checked-in trust anchor.

Each preparation verifies the matching native manifest/executable before downloading a model, then checks the selected model's size and full digest once. `PreparedEmbeddingResources` hands the resulting paths and native build identity directly to the process lifetime. A downloaded partial is verified before atomic promotion, without rehashing the published path. Ready encoding does not stat or hash model/native/license files before or after use; readiness and owned-process lifecycle checks remain active. A new preparation verifies again, without a process-wide verification cache or persistent marker. Readable model symlinks/hardlinks are supported; private partial-file writing and credential protections remain separate.

Changing the recipe (patch, source, model, or CMake flags) updates a trust anchor in two phases:

1. **Before building**, update the recipe inputs in `native/embedding/build-config.json` (for example the patch file together with its `patch.sha256`), then update the recipe-identity fields of every target manifest: `patchSha256`, `recipeIdentity`, and `cmakeFlags`. `cmakeFlags` stores the resolved flags, and the `@BUILD_COMMIT@` substitution embeds the first eight characters of the patch digest, so a patch change also moves bytes inside `cmakeFlags`. `recipeIdentity` is the `stableSha256` of `{schemaVersion, source, patchSha256, cmakeFlags, model}`. `bun run build:native` validates each freshly built candidate against these fields and fails with "native artifact manifest differs from the current source recipe" when the anchor lags behind, so the anchor must lead the build.
2. **After building and validating the candidate** (parent-liveness modes, backend checks), copy the freshly written `packages/backend/.artifacts/native/embedding/<target>/manifest.json` over the built platform's checked-in manifest to record its real `files` hashes and `buildIdentity`. Platforms you did not build keep their last verified file hashes until their own rebuild refreshes them; their phase-1 identity fields already match the new recipe, so source development on those platforms keeps validating.

The macOS CPU target is an M1-compatible ARMv8.4/FP16/dot-product baseline, with no i8mm and no compiled GPU backend. It is verified on M4, not yet on every Apple Silicon device. The Linux x64 CPU target is the AVX2 baseline: `GGML_SSE42/AVX/AVX2/BMI2/FMA/F16C` are on, while `GGML_NATIVE` and `GGML_OPENMP` stay off, so a Haswell-era (2013+) x86-64 CPU is required and expected to encode documents roughly an order of magnitude faster than the previous scalar baseline; AVX-512 and AVX-VNNI variants remain future work. The scalar baseline was built and verified on Ubuntu 24.04 (glibc 2.39) under WSL2, which does not by itself certify every Linux distribution; the AVX2 recipe needs one rebuilt, hash-refreshed artifact from the same toolchain before release. The Windows x64 target shares that AVX2 baseline with a static MinGW runtime. The patched Q4_0 artifact was verified on an Intel Core i7-13620H Windows x64 host using pinned WinLibs GCC 15.2.0: direct inference at 2/4/8 threads, Backend embedding/lifecycle integration, and isolated CLI index and default semantic-query smoke at 4 threads. This is single-host evidence, not certification of other CPUs or quantization formats.

Run the backend acceptance separately after the native build:

```sh
bun packages/backend/integration/native-inference.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
bun packages/backend/integration/daemon-embedding.integration.ts /absolute/path/to/granite-q4_0.gguf
```

The direct native inference script bypasses Backend and local configuration, explicitly using 2, 4, and 8 threads with the production launch arguments. Each process serves 20 authenticated requests covering English/Chinese singleton and short/long batch inputs, with 384-dimensional finite, normalized vectors. It accepts an optional second argument naming an unpacked release's native executable, so archive verification can exercise the shipped bytes instead of only checking version, describe and process startup. A real model must be supplied; it performs no download.

The HTTP embedding script optionally accepts a second argument pointing to the preserved validation reference directory; this also checks frozen tokenizer and Q4 vectors. It performs no model download. The daemon script uses an isolated runtime directory and verifies process reuse, timeout/crash recovery, parent death, and clean daemon restart.

For the integration entrypoints, scenario boundaries, optional frozen references, and the distinction between acceptance and performance observations, see the [backend integration guide](../../docs/development/backend-integration.md).
