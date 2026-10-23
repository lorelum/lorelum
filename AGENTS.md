# AGENTS.md

> This file defines the repository-wide baseline for AI coding agents. Humans should use [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow.

## Module guidance

When a task develops or changes one of the following areas, read and prioritize that module's `AGENTS.md`. Read README files, current specs/contracts, ADRs, active changes, tests, or source only when the task needs them; do not recursively load the repository merely because a file may be relevant.

When sources conflict, distinguish the current request and accepted rules from observations. Current user authorization defines task scope; an explicitly selected active change, current specs, current CLI/API/configuration/development contracts, and non-superseded Accepted ADRs define repository intent; code and tests show the current state; plans, summaries, research, and archived changes may provide context but do not silently define current behavior.

## Project and product boundaries

Lorelum is a Bun + TypeScript monorepo for engineering-knowledge retrieval: the Core engine, the `lore` CLI, format/schema tooling, local Backend capabilities, and supported host Skills/Hooks. Knowledge-Pack content lives in the separate `lorelum/lorelum-packs` repository.

| Area | Owns | Read before changing |
| --- | --- | --- |
| `packages/engine` | retrieval semantics, LocalStore, canonical reads, derived indexes, ranking | `packages/engine/AGENTS.md` |
| `packages/cli` | command parsing, execution-route selection, JSON envelopes | `packages/cli/AGENTS.md` |
| `packages/backend` | local daemon, model/runtime lifecycle, authenticated HTTP adapters | `packages/backend/AGENTS.md` |
| `packages/format` | public Practice/Pack schema, parsing, validation, localization helpers | `packages/format/AGENTS.md` |
| `apps/site` | public landing and documentation site | `apps/site/AGENTS.md` |
| `packages/ui` | reusable Web primitives and production design tokens | `packages/ui/AGENTS.md` |
| `plugins` | host-native Plugin overlays, marketplace mappings, Skills, Hooks, and host lifecycle integration | `docs/development/plugin-conventions.md`, `openspec/specs/agent-integration/spec.md`, `openspec/specs/plugin-distribution/spec.md` |
| `docs` | maintainer material, internal APIs, ADRs, research | `docs/AGENTS.md` |

Current integrations are CLI-first: use the released CLI together with host-native Skills and Hooks. Do not introduce local MCP servers, stdio wiring, MCP tools, MCP-backed Plugin behavior, or a local MCP wrapper around `lore`. A remote-retrieval MCP boundary requires a separately approved design.

## 运行环境边界

Lorelum 的 CLI、Backend 和宿主 Plugin 面向正常的本机 Agent 运行环境：命令能访问自身所需的文件、本地服务，以及该命令需要的网络能力。受限 Agent/宿主沙箱不属于产品应用场景。不要把沙箱内的失败当成 Lorelum 缺陷、兼容需求或验收阻碍；不要为此设计专用连接路径、降级方案、用户指引、Issue 或测试门槛。验收宿主集成时使用正常运行环境，不要求在沙箱内复现同样结果。

这条范围规则不削弱现有的本地认证、进程身份核对、文件权限、宿主审批和内部子进程隔离；它们各自保护正常运行环境里的真实边界，不是为了支持受限沙箱。

## Documentation ownership

- Decide the reader before changing documentation. A product user who needs to install, configure, operate, understand an observable result, or recover from an error reads the bilingual site under `apps/site/content/docs/`; update the matching English and Chinese pages only when that user-facing guidance changes.
- `docs/` is for maintainers: internal APIs, implementation and ABI details, architecture rationale, source/build verification, and operational evidence. Do not move such material into the site merely because the same code change has a user-facing aspect.
- A user guide and a maintainer document may both exist when they serve those distinct readers. They must not restate the same workflow or contract: link across the boundary instead. If a root document is fully equivalent to a site guide after a migration, delete the root copy and repair its inbound links.

For visual or component work, read [DESIGN.md](./DESIGN.md) first. Reusable Web components and production tokens belong in `packages/ui`; routes, copy, data, and page-specific composition belong to the consuming application. Run `bun run design:lint` after changing `DESIGN.md`.

## User experience and failure handling

- Treat user experience as a first-order product correctness requirement. For every feature and interaction, make the common, safe workflow complete with sensible defaults, clear precedence, and minimal manual setup or cleanup.
- Resolve actual, relevant ambiguity and recoverable failures without unnecessary user work. Do not preemptively add automatic recovery, retries, background work, locks, or new states for hypothetical rare cases; each mechanism needs a current requirement, observed failure, or credible high-impact risk that justifies its cost.
- An error is appropriate only for invalid input, an unsafe action, a genuinely ambiguous intent with no safe default, or a failure that cannot be recovered automatically. It must preserve canonical user data, avoid partial or hidden leftovers, explain the outcome plainly, and give one actionable next step.
- Never silently guess when doing so could lose data, weaken security, or change a public contract. In those cases, surface the decision early and make the trade-off understandable.

### 验证所有权与简化原则

- **调用方默认信任受控内部被调用方已保证的后置条件。** 跨函数、package、进程或本机 HTTP 不自动构成新的不可信边界；Engine、Backend、CLI 不得仅为接住上游结果，重复检查相同字段、范围、完整性或业务不变量。
- 完整验证放在明确负责的输入、准备、提交、发布或恢复边界。新增响应校验前，先核对上游契约和实际生产路径：只有独立的不可信来源、表示转换引入的新失败，或本层特有的请求—响应关联约束，才需要额外检查。HTTP 解码、身份认证和协议匹配不等于每层都要重新执行完整业务 schema。
- 不把“防止另一层内部代码写错”默认变成生产路径的防护职责。受类型和上游契约约束的实现错误，优先用类型、契约测试和必要的开发期断言发现；不能靠 mock 破坏上游保证，再用这类测试证明下游防御必不可少。外部输入或真实损坏能够触发的错误与恢复覆盖必须保留。
- 正常读取、状态查询和编码不得仅为防御上游已排除的情况，附加整包、全库、模型或 executable 扫描、重复哈希、深拷贝、递归 JSON/schema 验证或身份往返。对已完成 JSON 解码和结构验证、且未引入新值的结果，不再检查不可能由该来源产生的循环引用、Symbol 或对象原型。
- 优先删除重复职责、无效分支和纯转发层，不用校验缓存、有效性标记、新状态、锁或通用包装层掩盖本不该重复的工作。确有转换或生命周期责任的适配层保留；不要把多个真实边界合并成一个万能抽象。
- 简化必须保留外部输入验证、模型/native 接入质量检查、发布完整性、事务与快照一致性、认证及进程归属，以及损坏派生缓存的重新生成能力。现有契约要求的检查先按变更流程调整契约，不能以本节为由静默删除。
- 验证只补新增风险和证据缺口，复用对当前状态仍有效的检查结果。热路径新增额外工作时核对实际成本；不为每个修改增加全套重跑、强制 benchmark、形式化风险报告或脱离真实入口的防御分支测试。代码和检查更多，不代表质量更高。

### Product-first change planning

- A proposal for user-visible behavior is incomplete without a detailed product document in the active change. Start with the normal user's end-to-end path: their starting situation, the command or action they take, what they see, what they decide (if anything), how they reach a usable result, and what remains unchanged. Show concrete text/JSON examples where the interface is a CLI. Do not make a reader reconstruct the workflow from technical requirements, API types, or a task list.
- Cover materially different supported user situations and the failures a user can actually encounter. For each, show the visible outcome, whether prior work or installation remains usable, and one practical recovery action. Explain defaults, consent, installation/ownership boundaries, and what the feature deliberately does not do in ordinary product language before discussing internal mechanisms.
- Keep product behavior and engineering mechanism connected but distinct: the product document defines the experience; OpenSpec specs express testable public requirements; `design.md` explains implementation choices; `tasks.md` orders delivery and verification. Reconcile all four when a decision changes. Architecture-only or spec-only planning is not an acceptable final deliverable for a user-facing change.
- A proposed product document lives with its active change, not in the public site as though shipped. After implementation, update the matching English and Chinese site pages for the actual supported workflow. Validation must include walking the documented normal path on the real supported installation, not only schema checks and unit tests.

## Global commands and verification

- Runtime: Bun ≥ 1.1. Install dependencies with `bun install`.
- Test: `bun test`; lint: `bun run lint`; format: `bun run fmt`; typecheck: `bun run typecheck`.
- Run a package command with `bun run --filter <package> <script>` when a focused check exists.
- Use `bun build --compile` only when the task actually needs a single compiled binary. See [the development guide](./docs/development/README.md) for source, worktree, native, and release-staging workflows.
- For compiled model loading or semantic validation, run `bun run build:cli` and use the CLI from its complete `dist/release/<target>/` directory, keeping its matching `native/<target>/` runtime alongside it. `build:cli-only` produces only `dist/lore` without the native runtime; use it only for checks that do not need embedding. `build:release-staging` remains a compatibility alias for the same complete local build and does not publish a release.
- Before CLI acceptance of changed Backend code against the shared service, follow the [normal worktree workflow](./docs/development/README.md#normal-development-workflow). Ordinary start/query can reuse another compatible build; use the target worktree's CLI with `backend start --current-build` to select the code under test. This is not a prerequisite for ordinary knowledge retrieval or CLI-only/keyword checks.
- `bun run release:version prepare` explicitly selects artifacts and their independent versions; use `--dry-run` to preview. After a CLI Release is public and installer smoke passes, `bun run release:version docs --cli <version>` updates only the public install recommendation and also supports `--dry-run`. `bun run release:version check` checks registered version relationships offline. See the [maintainer release runbook](./docs/development/release.md) for selection, timing, review, and rollback.

Match verification to the changed boundary. New behavior ships with colocated `bun:test` coverage; format/parser and retrieval behavior have no exception. Mock filesystem and network in unit tests. A bug fix needs a regression test that fails before the fix and passes after it.

## Code and file conventions

- TypeScript runs under Bun with `strict: true`. Do not use `any` without justification; use a reasoned `// @ts-expect-error: <reason>` only when necessary.
- Use `PascalCase` for types/interfaces/classes and `camelCase` for values and functions.
- Prefer small, composable modules and typed errors. Do not throw bare strings or hide failures behind `null`.
- One file owns one coherent responsibility. Group modules by function in subdirectories; `index.ts` is a barrel only. File names should predict their exports.
- Co-locate `*.test.ts` with the source it covers.

## Git, contract, and release guardrails

- Never commit directly to `main`. Keep PRs focused, use Conventional Commits and the PR template, and review the complete diff before opening a PR. Link an existing Issue when the PR addresses it; create a new Issue only when the problem needs independent tracking, discussion, or coordination. Do not open one merely to restate a self-contained PR.
- Write Issues so a contributor without the current conversation can act: state the observed starting state and user/Agent impact, reproducible steps or a concrete scenario, expected outcome, realistic failure behavior, scope, and observable acceptance criteria. Separate evidence from hypotheses and avoid prerequisites to unrelated Issues unless the capability truly depends on them.
- Before publishing an Issue, search for duplicates and inspect the relevant current contract, implementation or test evidence, and comparable Issues. Use that evidence to explain the actual starting state and the decision a contributor must make; do not pad the body with generic process text, unsupported claims, private session context, or placeholders for the submitter to fill later. For a proposal, distinguish the recommended outcome from an unverified mechanism and state what evidence or design alignment is needed before implementation.
- Triage every newly published Issue, then read back its final body and labels. For an actionable bug or feature, apply `bug` or `enhancement` even when bypassing the form, plus exactly one difficulty label. Field feedback without an actionable scope need not be graded until it becomes a task.
  - `difficulty: beginner` means self-contained work within an existing contract; `difficulty: intermediate` means a focused package or workflow change; `difficulty: advanced` means public-contract, cross-boundary, or design-critical work. Grade the work, not the length of the write-up.
  - Add `design` when implementation needs design alignment, `evaluation` when a reproducible experiment must decide a product change, or `research` for an evidence-gated investigation. These describe the work, not its difficulty.
  - Add `help wanted` only when an outside contributor can act from public evidence and acceptance criteria. Add `good first issue` only to a bounded beginner task with a safe existing contract and `help wanted`, never to unresolved design or advanced work. Leaving invitation labels off is an explicit decision.
- Write PR descriptions for review, not as a commit summary: explain why, meaningful before/after behavior, important changes, compatibility and migration (or explicitly none), and evidence for success plus relevant failure/recovery paths. Name commands, results, and material environment/artifact boundaries; disclose unrun or failing checks and remaining risks. Claim performance gains only with comparable baseline and changed measurements under a stated workload/method, or label them as unverified hypotheses. Scale detail to the change; a small docs fix needs no benchmark.
- Before preparing a release PR or release notes, follow the [maintainer release runbook](./docs/development/release.md). Its complete previous-tag-to-candidate commit inventory, associated PR/Issue review, and reader-facing release-note coverage are required before the notes are ready for review.
- Public Practice/Pack schema, retrieval semantics, CLI surface, and any future approved remote MCP interface require design alignment before implementation. Internal refactors, focused bug fixes, performance work, and docs preserve the existing public contract unless they say otherwise.
- Do not modify `LICENSE`, future `LICENSE-*` files, the root `package.json` `license` field, or release/publish workflow steps without explicit maintainer approval.
- Do not run package-publish commands or publish to a public registry. Check dependency licenses before adding or upgrading dependencies; do not add GPL/AGPL dependencies to this Apache-2.0 core without maintainer approval.
- Before every commit or push, inspect the staged file list and diff, scan for secrets and private runtime data, and exclude local outputs, caches, logs, credentials, generated media, and machine-specific artifacts unless explicitly required.

### Change scale and OpenSpec

- **Small — execute directly, without OpenSpec.** It preserves current behavior and contracts within an existing boundary; documentation or current-spec edits that only correct facts, links, wording, examples, or formatting without changing a requirement or scenario are small.
- **Large — write an OpenSpec proposal first.** This includes any observable or cross-boundary contract/default/error change; architecture, ownership, lifecycle, integration, security/privacy, persistence, release, or platform change; and any cross-package or unresolved design decision.
- **If uncertain, treat it as large.** Do not split a coupled large decision into nominally small edits.
- Apply this gate to the change actually needed for the user goal, not a larger design invented from speculative failure cases. A hypothetical edge case alone does not expand the scope or require extra state, safeguards, or a separate proposal.

## Canonical references

- Product and user entry: [README.md](./README.md)
- Human contribution process: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Current capability specs: [openspec/specs](./openspec/specs/)
- Public user documentation: [site content](./apps/site/content/docs/)
- Maintainer documentation and internal APIs: [docs](./docs/)
- Architecture decisions and lifecycle: [docs/adr/README.md](./docs/adr/README.md)
- Current agent-integration scope: [agent-integration spec](./openspec/specs/agent-integration/spec.md)
- Archived changes are provenance only: [openspec/changes/archive](./openspec/changes/archive/)

When a task is ambiguous, inspect the relevant module guidance and canonical sources before asking. Ask only when the unresolved fact changes authorization, public contract, acceptance criteria, or a material architecture direction; continue independent, authorized investigation and verification in the meantime.
