# Development guide

This is the index for day-to-day development topics that do not belong in the product README. Start with [CONTRIBUTING.md](../../CONTRIBUTING.md) for the human contribution contract, then use the relevant links below.

## Topics

- [Environment and dependencies](../../CONTRIBUTING.md#development-environment)
- [Tests and CI](../../CONTRIBUTING.md#testing--ci)
- [Issues, branches, and PRs](../../CONTRIBUTING.md#development-workflow)
- [Local CLI and worktrees](#local-cli-and-multiple-worktrees)
- [Read an installed Practice with `lore get`](../cli/get.md)
- [Query installed Practices with `lore query`](../cli/query.md)
- [LocalStore Engine API](#localstore-engine-api)
- [QueryService Engine API](#queryservice-engine-api)
- [Point-read performance benchmark](./local-store-point-read-benchmark.md)
- [Keyword query quality and performance baseline](./keyword-query-benchmark.md)

## Proposed plans

- [Query phased implementation roadmap (Chinese)](../plans/query-roadmap.md) - keyword retrieval, configuration, embedding profiles, and derived indexes. The keyword query foundation is implemented; later phases remain proposed.

## Local CLI and multiple worktrees

The CLI's discoverable global option is:

```text
--store-root <path>
```

When omitted, the Store remains `~/.lorelum`. A relative path is resolved from the calling process's current working directory. `install`, `get`, and `query` consume LocalStore; do not infer support for other commands from this guide.

### Source-level CLI helper

`lore-dev` is a developer convenience, not a CLI requirement. Configure an equivalent helper with the initialization mechanism for the developer's shell; do not assume every developer uses zsh. The following is a zsh example, which can be added to `~/.zshrc` or pasted into one zsh session:

```zsh
lore-dev() {
  local repo_root store_root cli_entry

  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    print -u2 "lore-dev: current directory is not inside a Git worktree"
    return 1
  }

  cli_entry="$repo_root/packages/cli/src/main.ts"
  if [[ ! -f "$cli_entry" ]]; then
    print -u2 "lore-dev: expected CLI entrypoint not found: $cli_entry"
    return 1
  fi

  store_root="$(git rev-parse --path-format=absolute --git-path lorelum/store 2>/dev/null)" || {
    print -u2 "lore-dev: could not resolve the worktree-specific Git administrative Store"
    return 1
  }

  bun "$cli_entry" --store-root "$store_root" "$@"
}

alias ld='lore-dev'
```

The function anchors the source entrypoint to the current worktree and derives its Store from Git administrative data. That Store is worktree-specific and is not part of a commit. For example:

```zsh
lore-dev install pack-creator --pack-version 0.1.0
lore-dev install agentic-coding --pack-version 0.3.0
lore-dev get agentic-coding.testing.classify-failure-before-changing-test
```

The `ld` alias above is optional and specific to the zsh example.

### Agent setup check

Before an Agent exercises the current worktree's CLI source, it should check whether a `lore-dev` helper is available. If not, the Agent must ask the developer whether they want to configure one and which shell they use; it must not assume zsh or modify a shell startup file without explicit developer approval. Once configured, Agents should use the helper instead of rebuilding or repointing global `lore` for ordinary source-level CLI checks.

Use the source function while iterating. To check compiled behavior for the same checkout, run:

```zsh
bun run build:cli
./dist/lore --store-root "$(git rev-parse --path-format=absolute --git-path lorelum/store)" install pack-creator --pack-version 0.1.0
```

The globally available `lore` command should be a stable link into the primary checkout, such as `packages/cli/src/main.ts`. Do not repoint that link between worktrees, and do not point it at a Codex or temporary worktree. Use `lore-dev` when the current branch's source is what you need to exercise.

From the primary checkout, create that link once:

```zsh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/packages/cli/src/main.ts" "$HOME/.local/bin/lore"
rehash
```

This assumes `~/.local/bin` is already in `PATH`. If the destination exists, inspect it instead of replacing it blindly.

### Store isolation rules

Any manual Store-writing workflow (for example, future `uninstall` or `reindex` commands) must pass an explicitly isolated `--store-root`. These commands are not implemented merely because they are named here; the rule is a forward-looking safety constraint. `get` also needs an isolated root during development: its point-read path can initialize or recover the selected Store.

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

QueryService calls `readEffectivePractices()` once per request, builds and closes a request-local FTS5 database, and keeps request state local. It does not persist an index, retain a Session, or expose SQLite handles. The current keyword implementation is intentionally synchronous inside the service boundary; persistent indexes, semantic retrieval, and MCP lifecycle caching are later design work.
