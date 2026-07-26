# ADR 0004: Agent-first CLI protocol

- **Date:** 2026-07-23
- **Status:** Accepted
- **Related:** ADR 0002 (Bun + TypeScript toolchain), issue #1

## Context

Lorelum's first CLI consumers are AI coding agents, CI jobs, and editor integrations. A
human-oriented help screen is not a reliable process contract for those callers: they
need to discover commands, distinguish a usage error from a completed domain result,
and recover without parsing prose. The P0 CLI is only a startup stub, so P1 needs to
establish this boundary before domain commands are introduced.

The protocol must also preserve the package boundary. Commander, process I/O, and exit
codes are CLI adapter concerns; format, engine, and MCP must not depend on them.

## Decision

The candidate v1 contract is JSON-first. Every normal result is exactly one JSON line on
stdout, and optional diagnostic logs are written only to stderr. Each response has
`protocolVersion`, `toolVersion`, `command`, `ok`, and exactly one of `data` or `error`.
The CLI exports a JSON Schema for this envelope; command definitions provide the schema
for the contents of `data`.

```json
{
  "protocolVersion": 1,
  "toolVersion": "0.0.0",
  "command": "describe",
  "ok": true,
  "data": { "name": "lore" }
}
```

```json
{
  "protocolVersion": 1,
  "toolVersion": "0.0.0",
  "command": "unknown",
  "ok": false,
  "error": { "code": "usage.invalid", "message": "The command invocation is invalid." }
}
```

`lore`, `--help`, and `describe [command]` are capability-discovery operations and use
the same envelope. `--version` returns the protocol and tool versions in the same form.
Unknown options, missing option values, unknown command paths, and malformed command
paths are rejected before help or version can respond. Their exit code is `2` and their
messages must not echo raw arguments.

Exit codes are `0` for a successful call, `1` for a future completed call that reports a
blocking domain finding, and `2` for usage or runtime failures. The command registry is
the single source for parser construction, `describe` metadata, result schema, visible
errors, and protocol fixtures.

This ADR does not decide whether a future human-readable mode exists. If introduced, it
must not create a second result semantic or weaken the JSON contract.

## Consequences

**Positive:** callers can use a stable envelope, command discovery is machine-readable,
and domain packages remain independent of CLI process details.

**Negative / accepted risk:** strict validation is less familiar than conventional CLI
help behavior, and version 1 will need an explicit compatibility policy before it becomes
a published promise. The protocol is therefore Proposed until this ADR and its fixtures
are reviewed with the initial domain command.

**Follow-ups:** #2 adds deterministic local configuration, #3 validates the adapter with
`lore validate`, and #4 verifies the accepted fixture set on compiled binaries.
