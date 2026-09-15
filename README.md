<p align="center">
  <h1 align="center">Lorelum</h1>
  <p align="center">The right engineering Practice for the right AI coding task and moment.</p>
  <p align="center">
    <a href="./LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
    <a href="https://github.com/lorelum/lorelum/releases"><img alt="Status: public alpha" src="https://img.shields.io/badge/status-public%20alpha-orange"></a>
    <a href="./CONTRIBUTING.md"><img alt="Contributions welcome" src="https://img.shields.io/badge/contributions-welcome-brightgreen"></a>
  </p>
  <p align="center">
    <a href="https://lorelum.com/en/docs">Documentation</a> ·
    <a href="#quickstart">Quickstart</a> ·
    <a href="https://github.com/lorelum/lorelum-packs">Knowledge Packs</a> ·
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</p>

---

> **Public alpha · `0.1.0-alpha.1`.** Prebuilt archives are available for macOS on Apple Silicon, Linux x64, and Windows x64. macOS is Lorelum's priority platform and the most thoroughly validated release target. Linux and Windows are best-effort: compatibility and performance across all distributions, system builds, hardware, and local security policies are not guaranteed. CLI contracts, Pack formats, and indexes may change between releases; automatic migration is not guaranteed.

> **Give your Agent this prompt.**
>
> ```text
> Set up Lorelum v0.1.0-alpha.1 for this project using
> https://lorelum.com/en/docs/agents.md. Install the CLI and the agentic-coding
> Pack, connect the Lorelum Skill for this host, then verify a natural-language
> query and a full Practice read before using it for work.
> ```

Lorelum is a local retrieval layer for engineering knowledge. It turns reusable experience into **Practices**: self-contained guidance with explicit applicability conditions. **Knowledge Packs** organize those Practices into versioned collections that you can install and share.

## Working code leaves engineering decisions unresolved

You ask an agent to build a login page. It renders, submits the form, and passes a quick browser check. But the component now makes HTTP requests directly and persists the token itself. The visible result tells you little about whether the implementation respects the application's architecture and security boundaries.

If you know those boundaries, you can catch the problem in review. If you are building with an agent precisely because you do not yet have that experience, you may not know which question to ask. Either way, the engineering decision has already been made by the time you see the result.

The difficulty also appears in smaller decisions. A settings card grows extra interactions and abstractions because they look like thorough work. A long-running task reaches green component tests and is reported as complete before anyone checks persistence or authorization. Producing code, deciding how much work belongs in scope, and knowing what evidence establishes completion are different judgments.

This is the **knowledge-and-judgment gap**: the guidance that would improve a decision may be missing, overlooked, or applied outside the conditions that make it useful.

## Why more instructions are not enough

An `AGENTS.md`, `CLAUDE.md`, or Skill gives an agent valuable instructions. Teams can record conventions there, but a growing collection still leaves the agent to decide which advice matters now. A deployment rule, a UI pattern, and a migration checklist may all be correct while only one is relevant to the current change.

Timing matters too. Scope guidance helps before the plan expands; verification guidance helps before the agent declares success. If a compacted summary preserves a passed test but loses the acceptance criterion it covers, adding more generic rules does not restore the missing facts. The agent needs to recognize the decision in front of it and return to the right sources.

And writing a larger rulebook assumes you already know what belongs in it. A small team or vibe coder may need engineering experience they have not yet accumulated, while an experienced team needs its hard-earned lessons to remain usable beyond the person who wrote them.

## Bring the right Practice into the decision

Lorelum makes engineering experience something an agent can retrieve when it helps. A Practice explains a concrete action, the task or moment in which it applies, and the anti-patterns to avoid. A Knowledge Pack makes a collection of that guidance reviewable, versioned, and reusable across agents.

Before choosing how to implement the login page, the agent can describe the authentication change and the boundary it is deciding. Before planning the settings card, it can ask for guidance on scope and proportionate validation. Lorelum searches installed Packs for that description; the agent selects relevant summaries, reads the full Practices, and checks them against the repository and the user's request.

Teams can package their own standards. Vibe coders and small teams can start with shared Packs without first having to discover every engineering anti-pattern themselves. The aim is to make useful knowledge available at the moment of judgment, while keeping its applicability visible. The agent still owns the decision and the evidence needed to verify its work.

## See the workflow

Before defining an implementation plan:

```sh
lore query "I am implementing a settings card from an existing design. I am about to define the scope, implementation plan, and validation."
```

Choose a result using its `title` and `appliesWhen`, then read its `practiceId`:

```sh
lore get <practice-id>
```

The same task can call for different guidance as the work progresses:

| Moment | Guidance the agent can look for |
| --- | --- |
| Defining scope | Which changes are required, and what would add unrequested work? |
| Choosing an implementation | Which existing contracts and engineering boundaries matter? |
| Recovering after context loss | Which requirements, decisions, and evidence need rechecking? |
| Preparing to report completion | Does the verification cover the requested user-visible result? |

The agent decides when to query and which Practices apply. Lorelum retrieves the knowledge; the agent remains responsible for the work.

## What you can use today

- **Local semantic retrieval.** Search installed Practices by task and moment with `lore query`. The local Backend reuses the embedding model across requests.
- **Full Practice reads.** Use `lore get` to read complete guidance and its applicability conditions before acting on a summary.
- **Versioned Knowledge Packs.** Install, inspect, update, and remove Packs. Keep separate collections with `--store-root`.
- **Agent integration.** Use the Lorelum Skill in command-capable agents, or the official Codex Plugin with its installed-Pack catalog.
- **An explicit offline path.** Use `lore query --mode keyword` for term matching without a model or Backend.
- **Pack authoring tools.** Validate source files, format Practices, and maintain localization with the CLI.

Natural-language queries use a fixed local embedding model and a Store-specific index. Initial Pack installation and model preparation need downloads; once prepared, retrieval runs locally. Lorelum searches your installed knowledge, not the web.

## Quickstart

### 1. Install the CLI

Choose the installer for the host that will run `lore`.

#### macOS on Apple Silicon and Linux x64

```sh
curl -fsSL https://raw.githubusercontent.com/lorelum/lorelum/main/install.sh | sh -s -- --version 0.1.0-alpha.1
```

#### Windows x64

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/lorelum/lorelum/main/install.ps1))) -Version 0.1.0-alpha.1
```

The macOS/Linux installer verifies the archive and creates `~/.local/bin/lore`. The Windows installer verifies the ZIP and creates `$env:LOCALAPPDATA\Lorelum\bin\lore.cmd`. Keep the complete release directory intact: semantic retrieval uses the native libraries and runtime assets shipped with the executable. Do not run `install.sh` or double-click the installer on Windows; run the command above from an already-open PowerShell session so errors stay visible.

On macOS and Linux, make sure `~/.local/bin` is on `PATH`. The Windows installer adds `$env:LOCALAPPDATA\Lorelum\bin` to your user `Path` when needed; open a new terminal, then check:

```sh
lore --version
```

For manual installation, source builds, and updates, see [Installation](https://lorelum.com/en/docs/installation).

### 2. Install a Pack

```sh
lore pack install agentic-coding
```

Installation saves the Pack and starts the required semantic index work. The response's `data.indexSync` indicates whether that work is ready, pending, or failed. Pack installation is preserved if indexing fails.

### 3. Retrieve and read

```sh
lore query "I am changing the login flow and deciding which existing API and security boundaries to check before coding."
lore get <practice-id>
```

Replace `<practice-id>` with a `practiceId` from `data.results`. Read the full body and check its applicability to the task.

On first use, a query may return `data.state: "preparing"` while the model downloads or loads. Run `lore model load` to wait, then retry. If the query reports a missing index, run `lore index build` and inspect any returned operation with `lore index operation <operation-id>` until it is ready. See [Troubleshooting](https://lorelum.com/en/docs/troubleshooting) for recovery.

## Connect your agent

The Skill explains when to retrieve, how to describe the task and moment, and why the agent should read full Practices before applying them.

| Host                         | Setup                                                        |
| ---------------------------- | ------------------------------------------------------------ |
| Codex                        | Official Plugin, including the Skill and a Pack-catalog Hook |
| Claude Code                  | Project or personal Lorelum Skill                            |
| Cursor                       | Project Lorelum Skill                                        |
| Other command-capable agents | Host-supported Skill or project instructions                 |

For Codex, after installing the CLI and a Pack:

```sh
codex plugin marketplace add lorelum/lorelum
codex plugin add lorelum@lorelum
```

Review the Hook when prompted, then start a new task. The Hook reads installed Pack metadata with `lore pack list --details`; the Skill decides when to make its targeted semantic query and read Practices. The Plugin does not bundle the CLI. Other command-capable agents use the generic Lorelum Skill, which establishes a Pack Catalog with `lore pack list --details` only when the current context does not already contain one.

See [Agent integration](https://lorelum.com/en/docs/agent-setup) and [Codex setup](https://lorelum.com/en/docs/codex) for installation and verification.

## Choose or create a Knowledge Pack

| Official Pack | Version | Focus |
| --- | --- | --- |
| `agentic-coding` | `0.3.1` | Planning, implementation, verification, recovery, and delivery decisions |
| `pack-creator` | `0.1.0` | Writing, reviewing, and publishing Practices and Packs |
| `react-web-craft` | `0.1.0` | React web application design and performance: component state, async data flow, loading, rendering, and composition |

Browse what you have installed:

```sh
lore pack list --details
lore pack list agentic-coding
```

A Practice is a Markdown document with structured metadata. For example:

```markdown
---
id: delivery.verify-user-flow
title: Verify the complete user flow
stage: verification
tech_stack: [web]
applies_when: Preparing to report completion of a user-visible change.
severity: warn
---

1. Read the agreed acceptance criteria before selecting verification.
2. Check the user action, its observable result, and the relevant failure path.
3. Report which criteria were verified and which remain open.

Match verification to the change and risk. For copy-only edits, keep unrelated API and storage behavior outside the verification scope.
```

Keep each Practice independently understandable: an agent may retrieve it without reading the rest of the Pack. Follow [Create a Pack](https://lorelum.com/en/docs/create-pack) for a complete, valid example, or explore the [official Pack repository](https://github.com/lorelum/lorelum-packs).

## Responsibilities and limits

| Component | Responsibility |
| --- | --- |
| Agent and Skill | Describe the task and moment, request guidance, read it, and judge applicability. |
| Lorelum retrieval | Search installed Packs, rank candidates, and return summaries or complete Practices. |
| Local Backend | Host the model runtime and long-running semantic index work. |
| Store | Keep installed Pack data and derived indexes for the selected root. |

Lorelum Core does not manage your task, inspect the full transcript, or decide that an implementation is accepted. A retrieved Practice is guidance, not verification evidence.

The current Codex Hook supplies a Pack catalog at supported session events. Broader guidance before and after compaction depends on host capabilities and remains [research](https://github.com/lorelum/lorelum/issues/32). The current user integration is through the CLI and Skill.

## Documentation and contributing

- [User documentation](https://lorelum.com/en/docs) — guides, configuration, and troubleshooting.
- [CLI reference](https://lorelum.com/en/docs/cli) — commands, JSON responses, errors, and exit codes. Run `lore describe query` for the installed schema.
- [Development guide](./docs/development/README.md) — source builds, local CLI work, and isolated Stores.
- [Contributing](./CONTRIBUTING.md) — issues, design alignment, tests, and pull requests.
- [Agent instructions for this repository](./AGENTS.md) — conventions for AI-assisted contributions.
- [Discussions](https://github.com/lorelum/lorelum/discussions) and [issues](https://github.com/lorelum/lorelum/issues) — questions, proposals, and bug reports.
- [Security policy](./SECURITY.md) — private vulnerability reporting.

## License

This repository is licensed under [Apache 2.0](./LICENSE). The [official Knowledge Packs](https://github.com/lorelum/lorelum-packs) use CC-BY-4.0; other Packs carry their own licenses.

The name combines **Lore**, knowledge handed down through practice, and **Lum**, light: engineering experience that AI agents can work by.
