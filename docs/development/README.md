# Development guide

This is the index for day-to-day development topics that do not belong in the
product README. Start with [CONTRIBUTING.md](../../CONTRIBUTING.md) for the
human contribution contract, then use the relevant links below.

## Topics

- [Environment and dependencies](../../CONTRIBUTING.md#development-environment)
- [Tests and CI](../../CONTRIBUTING.md#testing--ci)
- [Issues, branches, and PRs](../../CONTRIBUTING.md#development-workflow)
- [Local CLI and worktrees](#local-cli-and-multiple-worktrees)

## Local CLI and multiple worktrees

The CLI's discoverable global option is:

```text
--store-root <path>
```

When omitted, the Store remains `~/.lorelum`. A relative path is resolved from
the calling process's current working directory. `install`, `query`, and `get`
consume the selected LocalStore.

### A copyable `lore-dev` function

Define this function in the shell where you are working (or temporarily paste
it into a session):

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
```

The function anchors the source entrypoint to the current worktree and derives
its Store from Git administrative data. That Store is worktree-specific and is
not part of a commit. For example:

```zsh
lore-dev install pack-creator --pack-version 0.1.0
```

Use the source function while iterating. To check compiled behavior for the
same checkout, run:

```zsh
bun run build:cli
./dist/lore --store-root "$(git rev-parse --path-format=absolute --git-path lorelum/store)" install pack-creator --pack-version 0.1.0
```

The globally available `lore` command should be a stable link into the primary
checkout, such as `packages/cli/src/main.ts`. Do not repoint that link between
worktrees, and do not point it at a Codex or temporary worktree. Use
`lore-dev` when the current branch's source is what you need to exercise.

From the primary checkout, create that link once:

```zsh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/packages/cli/src/main.ts" "$HOME/.local/bin/lore"
rehash
```

This assumes `~/.local/bin` is already in `PATH`. If the destination exists,
inspect it instead of replacing it blindly.

### Store isolation rules

Any manual Store-writing workflow (for example, future `uninstall` or
`reindex` commands) must pass an explicitly isolated `--store-root`. These
commands are not implemented merely because they are named here; the rule is a
forward-looking safety constraint. Read-only commands such as `query` and `get`
are safe against the worktree Store, but they still honor `--store-root`
explicitly when an alternate Store is intended.

Automated tests should continue to use temporary directories for Store data.
They must not write to `~/.lorelum` or to a developer's shared Store.

There is intentionally no Store-related environment variable, automatic
worktree detection in the global CLI, project scope, or implicit Store. The
global override is explicit and discoverable; callers that need isolation must
provide it.
