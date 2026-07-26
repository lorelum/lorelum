# ADR 0005: Deterministic local CLI configuration

- **Date:** 2026-07-23
- **Status:** Accepted
- **Related:** ADR 0004, issue #2

## Context

Agents and CI commonly invoke the CLI from changing working directories. Repository
configuration discovery, dotenv loading, and implicit parent-directory traversal would
make an identical invocation select different local state. Early Lorelum only needs
read-only CLI runtime configuration; endpoint, authentication, and secrets belong to a
later endpoint-mode design.

## Decision

Configuration resolution is deterministic: global `--config <path>` wins over
`LORELUM_CONFIG`, which wins over the platform user path. The default is
`%APPDATA%\\Lorelum\\config.json` on Windows and
`$XDG_CONFIG_HOME/lorelum/config.json` elsewhere, falling back to
`$HOME/.config/lorelum/config.json` when XDG is unset.

The v1 file is strict JSON with `version: 1`. Unknown fields, unsupported versions,
invalid JSON, non-regular files, symbolic links, and files larger than 64 KiB fail with
structured errors. A missing default file selects an explicit built-in default; a missing
or invalid explicit/environment file fails and never falls back. `config path` exposes the
resolved path and source only on request; `config show` returns the validated configuration
and never writes, migrates, or repairs it.

## Consequences

This gives agents a reproducible local context and a diagnosable source of truth without
silently importing repository state. It deliberately does not solve endpoint selection,
credentials, tenant settings, config editing, or project-local overrides; those require a
separate product decision when endpoint mode is introduced.
