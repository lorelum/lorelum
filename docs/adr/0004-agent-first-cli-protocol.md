# ADR 0004: Agent-first CLI protocol

- **Date:** 2026-07-23
- **Status:** Proposed
- **Related:** ADR 0002 (Bun + TypeScript toolchain), issue #20 (split from issue #13)

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
errors, and exit codes. Independent golden fixtures validate the outer envelope schema;
built-in command tests validate response data against the result schema in the registry.

Exit code `1` is valid only with a successful (`ok: true`) completed result; failure
envelopes always use exit code `2`. Each command definition's `errorCodes` is the
allowlist for errors visible to callers. A handler error not declared by the selected
command is normalized to `runtime.unexpected`, which every command must declare.
Handlers return structured data and an optional completion exit code; the CLI adapter is
the sole owner of validating JSON-safe data and rendering the response, so a completed
invocation writes one JSON line. Command options model flags, values, defaults, and
required presence separately; Commander declarations and discovery text are derived from
that metadata. Framework options additionally declare whether they apply globally or only
to the root invocation; options that emit a static response also expose its command and
result schema through discovery. Until local argument inheritance is explicitly modeled,
a command with child commands cannot declare its own positional arguments or options.

This ADR does not decide whether a future human-readable mode exists. If introduced, it
must not create a second result semantic or weaken the JSON contract.

## Consequences

**Positive:** callers can use a stable envelope, command discovery is machine-readable,
and domain packages remain independent of CLI process details.

**Negative / accepted risk:** strict validation is less familiar than conventional CLI
help behavior, and version 1 will need an explicit compatibility policy before it becomes
a published promise. The protocol remains Proposed until maintainers accept this ADR
during review; domain commands are not required for that decision.

**Follow-ups:** separate changes will add deterministic local configuration, validate the
adapter with `lore validate`, and verify the candidate fixture set on compiled binaries.
