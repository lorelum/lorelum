# Development guide

This is the index for day-to-day development topics that do not belong in the product README. Start with [CONTRIBUTING.md](../../CONTRIBUTING.md) for the human contribution contract, then use the relevant links below.

## Topics

- [Local backend API](../api/README.md)
- [CLI command index](../cli/README.md)
- [Backend configuration](../configuration/README.md)
- [Environment and dependencies](../../CONTRIBUTING.md#development-environment)
- [Tests and CI](../../CONTRIBUTING.md#testing--ci)
- [Issues, branches, and PRs](../../CONTRIBUTING.md#development-workflow)
- [Local CLI and worktrees](#local-cli-and-multiple-worktrees)
- [Embedding native runtime](#embedding-native-runtime)
- [Discover installed Packs with `lore list`](../cli/list.md)
- [Read an installed Practice with `lore get`](../cli/get.md)
- [Query installed Practices with `lore query`](../cli/query.md)
- [Manage a Store semantic index with `lore index`](../cli/index.md)
- [LocalStore Engine API](#localstore-engine-api)
- [QueryService Engine API](#queryservice-engine-api)
- [Point-read performance benchmark](./local-store-point-read-benchmark.md)
- [Compiled LocalStore mutation benchmark](./local-store-mutation-benchmark.md)
- [Keyword query quality and performance baseline](./keyword-query-benchmark.md)
- [Site deployment workflow](./site-deploy.md)

## Design records and remaining plans

- [Query phased implementation roadmap (Chinese)](../plans/query-roadmap.md) - keyword retrieval, configuration, embedding profiles, and derived indexes. The keyword query foundation is implemented; later phases remain proposed.
- [Local resident backend design (Chinese)](../plans/local-backend-service-design.md) - the historical first-stage lifecycle and Store-isolation design. For current commands and model behavior, use the CLI documents above.

## Local CLI and multiple worktrees

The CLI's discoverable global option is:

```text
--store-root <path>
```

When omitted, the Store remains `~/.lorelum`. A relative path is resolved from the calling process's current working directory. `install`, `list`, `get`, `query`, and `index` use LocalStore; backend and model lifecycle commands do not. Do not infer support for other commands from this guide.

### Normal development workflow

All commands in this section start in the **target worktree**. The normal source path is the current worktree's TypeScript entrypoint, `bun packages/cli/src/main.ts ...`. `lore-dev` is an optional human shortcut for that same command; it is not a requirement for Agents or automation. The globally installed `lore` remains a stable command for the primary checkout and is not a worktree-validation tool.

Use an isolated Store by default when validating a worktree. This applies even to a command that is mostly a read: opening a Store can recover state and query/index features can update derived state. Omit `--store-root` only when the task explicitly calls for the developer's real shared Packs and indexes.

| What is being checked | Required route | Do not use |
| --- | --- | --- |
| TypeScript CLI or keyword behavior | `bun packages/cli/src/main.ts ...`; a human may use `lore-dev ...` instead | Global `lore` or an executable produced by another worktree. |
| Backend lifecycle only | `bun packages/cli/src/main.ts backend start/status/stop` | `build:native`; no model runtime is needed just to control the Backend. |
| Source-level model, embedding, or semantic index behavior | `bun run build:native`, then `bun packages/cli/src/main.ts backend start`, `bun packages/cli/src/main.ts model load`, and `bun packages/cli/src/main.ts --store-root <isolated-root> index build` | `build:cli`; it has no native embedding runtime. Backend and model startup are explicit in the current product. |
| Compiled non-embedding behavior | `bun run build:cli` followed by `./dist/lore ...` | That binary for a model, embedding, or semantic-index check. |
| Runnable compiled embedding candidate | `bun run build:release-staging` followed by `./dist/release/darwin-arm64/lore ...` | `build:release` unless archive validation is the purpose. |
| Final archive/package | `bun run build:release` | Treating the archive command as the normal development build. |

For example, a source-level semantic-index check against a worktree-local Store is:

```zsh
bun run build:native
bun packages/cli/src/main.ts backend start
bun packages/cli/src/main.ts model load
bun packages/cli/src/main.ts --store-root "$(git rev-parse --path-format=absolute --git-path lorelum/dev-store)" index build
bun packages/cli/src/main.ts --store-root "$(git rev-parse --path-format=absolute --git-path lorelum/dev-store)" index status
```

The Backend and model are user-level resources; the explicit Store root selects only Pack data and its derived index. Stop a test Backend with `bun packages/cli/src/main.ts backend stop` when the check is complete.

### Source entrypoint and human helper

Agents and automation can always use the direct source command below from the target worktree:

```sh
bun packages/cli/src/main.ts --help
```

`lore-dev` is only a developer convenience for people who prefer a shorter command. Configure an equivalent helper with the initialization mechanism for the developer's shell; do not assume every developer uses zsh. The following is a zsh example, which can be added to `~/.zshrc` or pasted into one zsh session:

```zsh
lore-dev() {
  local repo_root cli_entry

  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    print -u2 "lore-dev: current directory is not inside a Git worktree"
    return 1
  }

  cli_entry="$repo_root/packages/cli/src/main.ts"
  if [[ ! -f "$cli_entry" ]]; then
    print -u2 "lore-dev: expected CLI entrypoint not found: $cli_entry"
    return 1
  fi

  bun "$cli_entry" "$@"
}

alias ld='lore-dev'
```

The function anchors the source entrypoint to the current worktree while leaving Store selection to the CLI. Without `--store-root`, it uses the normal default `~/.lorelum`; pass `--store-root` explicitly when a check requires an isolated Store. For example:

```zsh
lore-dev query "responsibility boundary" --top-k 2
lore-dev --store-root "$(git rev-parse --path-format=absolute --git-path lorelum/store)" \
  install pack-creator --pack-version 0.1.0
```

The `ld` alias above is optional and specific to the zsh example.

### Calling the human helper from non-interactive shells

The helper can already be correctly configured in a developer's `~/.zshrc` while a command runner cannot see it: non-interactive zsh does not load `.zshrc`. A human or automation that intentionally needs this convenience wrapper may invoke it through interactive zsh; Agents do not need to do this because they should call the source entrypoint directly.

For a developer who uses the zsh setup above, verify and invoke the existing function through interactive zsh:

```zsh
zsh -ic 'whence -w lore-dev'
zsh -ic 'lore-dev --store-root /absolute/path/to/isolated-store list'
```

The command inherits the caller's current worktree, so `lore-dev` still anchors `packages/cli/src/main.ts` to that worktree. Use the developer's documented interactive-shell equivalent for shells other than zsh; do not guess a shell or persist a new helper. A failed helper lookup is never a reason for an Agent to change shell configuration.

### Compiled checks

Use the source function while iterating. `bun run build:cli` produces `dist/lore` without the native embedding runtime, so it is suitable only for non-embedding compiled checks such as keyword benchmarks. For a runnable compiled embedding check in the same checkout, build release staging instead:

```zsh
bun run build:release-staging
./dist/release/darwin-arm64/lore --store-root /absolute/path/to/isolated-store index status
```

`build:release-staging` creates an unpacked local artifact and does not publish anything. `build:release` is for archive/package validation. Do not use a global `lore` or a binary built from a different worktree to validate current source changes.

The globally available `lore` command should be a stable link into the primary checkout, such as `packages/cli/src/main.ts`. Do not repoint that link between worktrees, and do not point it at a Codex or temporary worktree. Use `lore-dev` when the current branch's source is what you need to exercise.

From the primary checkout, create that link once:

```zsh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/packages/cli/src/main.ts" "$HOME/.local/bin/lore"
rehash
```

This assumes `~/.local/bin` is already in `PATH`. If the destination exists, inspect it instead of replacing it blindly.

### Embedding native runtime

Embedding source checks need one native candidate in the current worktree:

```sh
bun run build:native
```

The candidate is copied to `packages/backend/.artifacts/native/embedding/<target>/` (`darwin-arm64` on macOS, `linux-x64` on Linux). The completed native runtime is shared only as a developer build cache: `~/Library/Caches/Lorelum/native/v1` on macOS, `$XDG_CACHE_HOME/lorelum/native/v1` (or `~/.cache/lorelum/native/v1`) on Linux. A matching second worktree verifies and copies that runtime instead of running CMake again. The cache does not belong to `~/.lorelum`, is not selected by `config.yaml`, and is never used as the backend runtime path; removing it merely makes the next `build:native` rebuild the candidate.

This remains a CPU-only build. macOS uses the pinned CMake download and an ARMv8.4 baseline; Linux uses the distribution CMake/toolchain and the generic x86-64 baseline (no AVX2/AVX-512 requirement, OpenMP disabled). The source archive, any pinned CMake download, and CMake intermediate files remain in the invoking worktree's ignored `.cache/native-build/` and are only needed on a cache miss. See the [native build guide](../../native/embedding/README.md) for lifecycle checks and the release/source trust boundary.

### Store isolation rules

Any worktree-validation command that can open or change a Store must pass an explicitly isolated `--store-root`, unless the task explicitly calls for the developer's real shared Store. This includes point reads and queries: they can initialize, recover, or update derived state.

Automated tests should continue to use temporary directories for Store data. They must not write to `~/.lorelum` or to a developer's shared Store.

There is intentionally no Store-related environment variable, automatic worktree detection in the global CLI, project scope, or implicit Store. The global override is explicit and discoverable; callers that need isolation must provide it.

## LocalStore Engine API

Create the facade at your application's composition root and pass it to callers. Construction does not open a database; each operation owns and closes its connection. Pass a root per operation, so sharing the facade does not share a mutable current root or snapshot.

```ts
import { createLocalStore } from "@lorelum/engine";

const store = createLocalStore();
const root = { rootPath: "/path/to/isolated-store" };
const effective = await store.getEffectivePractice(root, "example.api.guidance");
if (effective !== undefined) {
  console.log(effective.practice.body, effective.contentDigest);
}
```

Use `getEffectivePractice` for an exact ID, `readEffectivePractices` for one full consistent corpus, and `open` when the caller explicitly needs the full artifact audit. Both point and corpus reads validate the SQLite rows they return; only `open` hashes installed artifacts. `getEffectivePractice` and `open` can converge pending operation journals; `readEffectivePractices` does not add that write-recovery step. Invalid IDs throw `InvalidPracticeIdError` before I/O; missing IDs return `undefined`; inconsistent or busy Stores throw `StoreRecoveryRequiredError` or `StoreBusyError`. Do not turn these errors into an empty result.

See [ADR 0011](../adr/0011-local-store-point-read-and-query-boundary.md) for the consistency boundary and query lifecycle.

## QueryService Engine API

`QueryService` owns the query use case in Engine so CLI and future MCP callers do not duplicate validation, snapshot reads, ranking, or result assembly. Create it at the composition root and inject a LocalStore facade:

```ts
import { createLocalStore, createQueryService } from "@lorelum/engine";

const store = createLocalStore();
const queryService = createQueryService({ store });
const result = await queryService.query(
  { rootPath: "/path/to/isolated-store" },
  { text: "React API boundary", limit: 5 },
);
```

`text` is trimmed, must not be empty, and is limited to 4,096 Unicode code points. `limit` defaults to `5` and must be an integer from `1` to `50`. The result has `mode: "keyword"` and `results` containing `practiceId`, `title`, `stage`, `techStack`, `appliesWhen`, `severity`, and `contentDigest`; it does not include full bodies or internal scores. Invalid requests throw `InvalidQueryRequestError`. FTS5 runtime failures throw `KeywordIndexUnavailableError` or `KeywordIndexError`; callers at protocol boundaries translate these types to their own error codes.

QueryService keeps its public request/result contract local, but reuses a derived FTS5 SQLite index under the selected Store root across CLI processes. It binds that index to a verified effective revision, updates it from LocalStore's retained revision deltas, and rebuilds only when the index or its history cannot be trusted. Canonical Store rows remain the source of returned summaries; QueryService does not expose SQLite handles. Semantic retrieval and MCP lifecycle caching remain later design work.

全局配置基础包是 `packages/config`，CLI、Engine 和 backend 可直接依赖它；它不依赖服务进程。各包自己的 config 模块负责 section schema 与业务默认值。共享文件初始化由应用组装层触发，不能放进某个消费方的读取函数。详见[配置包边界](../configuration/README.md#包边界与直接读取)。
