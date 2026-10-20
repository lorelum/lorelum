## Lorelum __RELEASE_TAG__

This release adds an opt-in multi-view semantic retrieval method, a native omp Plugin, and a bilingual developer blog. It also reduces repeated local validation work and makes Backend recovery instructions actionable. **The default semantic method remains `single-vector`.** Integrations that consume CLI failures must stop reading the removed `error.recovery` field; see the upgrade notes below.

## New capabilities

### Compare semantic retrieval methods without changing configuration

Try the experimental method for one query:

```sh
lore query "the engineering decision you are making" --mode multi-view-vector
```

`--mode single-vector` selects the default method for one invocation, including when your configured default is multi-view. Neither override writes configuration. Ordinary semantic queries and index operations use `query.retrievalMethod` when configured, otherwise `single-vector`; `--mode keyword` remains the explicit offline lexical path. Semantic JSON results now report the actual `retrievalMethod`, including preparing, indexing, partial, and complete results. [#279](https://github.com/lorelum/lorelum/pull/279)

Multi-view represents a Practice through a task card and bounded body sections, and represents a query through its complete text and clauses. It is vector-only: the intermediate keyword/BM25 reranking experiment was removed. Each method has its own Profile and derived index, so comparing methods does not mix their vectors or overwrite the other method's target. The shared Store, model lifecycle, and index scheduling remain in use. See the [query guide](https://lorelum.com/en/docs/reference/query) and [configuration guide](https://lorelum.com/en/docs/configuration).

**This is an experiment, not a generally better ranking default.** Local evaluations improved some target rankings but also lost useful supporting Practices and some wider-pool recall. The [bilingual retrieval article](https://lorelum.com/en/blog/task-aware-retrieval) explains the trade-offs and discarded approaches. Candidate recall, ranking, and applicability limitations remain tracked in [#236](https://github.com/lorelum/lorelum/issues/236). [#287](https://github.com/lorelum/lorelum/pull/287)

### Native omp Plugin with scoped context

omp joins Codex, Claude Code, Cursor, WorkBuddy, and ZCode as an official Plugin host. Install the CLI and a Pack separately, ensure `lore` is on omp's inherited `PATH`, then run:

```sh
omp plugin marketplace add https://github.com/lorelum/lorelum.git
omp plugin install lorelum@lorelum-plugins
```

The Plugin provides the Lorelum Skill and a temporary Pack Catalog for the main Agent. Eligible successful `lore get` reads can supply child Agents with bounded candidate metadata from the originating main session; child reads remain separately scoped. Hints are possibly relevant, incomplete metadata, not Practice bodies or trusted instructions. The omp-specific `agent.subagentPackCatalog` option defaults to `false`; enabling it adds child Catalog metadata without disabling main Catalog or read hints when it is off. [#276](https://github.com/lorelum/lorelum/pull/276)

The extension selects POSIX shell association on macOS/Linux and PowerShell association on native Windows. Real-host acceptance covered **omp on macOS arm64**; Linux and Windows omp host flows were not verified. This release does not add pi integration. See the [omp guide](https://lorelum.com/en/docs/omp) and [host capability comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities). [#277](https://github.com/lorelum/lorelum/pull/277)

## Performance and local validation

Normal ready-path operations no longer repeatedly hash the CLI executable and model, scan complete Packs, or audit every SQLite vector merely to read a result. Full verification belongs to input, preparation, publication, and recovery boundaries; snapshot consistency, actual read failures, authentication, process ownership, and damaged shared-vector-cache recovery remain protected. [#285](https://github.com/lorelum/lorelum/pull/285)

The compiled-CLI comparison in #285 measured these **historical baseline-to-change** mean latencies, not an alpha.5-to-alpha.6 benchmark:

| Ready operation | Baseline | Change | Mean reduction |
| --- | ---: | ---: | ---: |
| Single-vector query | 254.89 ms | 176.85 ms | 30.6% |
| Multi-view query | 303.73 ms | 194.32 ms | 36.0% |
| Practice `get` | 238.14 ms | 185.24 ms | 22.2% |
| Backend status | 217.28 ms | 170.29 ms | 21.6% |

Workload: macOS arm64, Bun 1.4.2, CPU/4 threads, the fixed Granite Q4_0 model, 4 Packs/97 Practices, resident Backend/model, and fresh compiled CLI processes. An ABBA comparison against `724389e` collected 40 samples per version and metric, including process startup and output collection. The PR records the method, spread, and limits; the exact five query texts were not retained, so it is not a replayable benchmark suite. **These numbers are not cross-platform, inference-throughput, cold-build, or final-release guarantees.** Preparing the baseline's cold index required a temporary timeout increase; the default-timeout limitation was not fixed by that measurement.

Native embedding now submits document and multi-part query inputs as batches and restores results to input order. This changes the previous serial-per-input path without adding a new CLI option. Its limited direct-native measurements are separate from the compiled-CLI table above; batching can increase memory use and introduce small floating-point/ranking differences. [#286](https://github.com/lorelum/lorelum/pull/286)

Logging now normalizes records once at their producer, and settings consumers share one configuration document per invocation. Enabled lifecycle logs contain one ordinary command-start and command-complete record rather than duplicates; trace isolation, bounded records, credential exclusion, and failure diagnostics remain. The separate 48-synthetic-Practice comparison in #288 showed only small, noisy query changes and **no evidence of overall index-build acceleration**; its results are not additive to the table above. [#288](https://github.com/lorelum/lorelum/pull/288)

## Bug fixes

- Concurrent Registry catalog changes within one process no longer contend with themselves before taking the existing cross-process lock. Mutations to the same catalog are serialized; atomic writes, external-lock protection, and busy errors remain. A genuinely held external lock can still time out. [#267](https://github.com/lorelum/lorelum/pull/267)
- Backend build/protocol mismatch failures now provide the complete safe stop/start/retry sequence instead of incomplete recovery-policy fragments. A deferred guarded stop preserves other active work; ordinary queries do not automatically stop the Backend. [#271](https://github.com/lorelum/lorelum/pull/271), closes [#227](https://github.com/lorelum/lorelum/issues/227)
- Semantic embedding respects the Backend's eight-input limit when a Practice produces many views or a query contains many clauses. Body-view splitting also budgets heading context, preventing long headings from pushing a view over its token budget. These fixes are part of the opt-in method delivery. [#279](https://github.com/lorelum/lorelum/pull/279)
- The internal retrieval benchmark harness now opens the same content-addressed derived cache as a Store-only index build instead of incorrectly reporting `index_unavailable` when Store and cache roots differ. This does not change public `lore query` routing. [#279](https://github.com/lorelum/lorelum/pull/279)

## Developer blog and contributor workflow

The [English](https://lorelum.com/en/blog) and [Chinese](https://lorelum.com/zh/blog) developer blog adds localized articles, category discovery, search, and URL pagination. Its first articles explain [Practice-injection measurements](https://lorelum.com/en/blog/practice-injection-measurement) and [task-aware retrieval experiments](https://lorelum.com/en/blog/task-aware-retrieval). The injection study uses three tasks and hand-selected Practices: it is directional evidence, not proof of universal quality gains or retrieval effectiveness. [#210](https://github.com/lorelum/lorelum/pull/210) [#287](https://github.com/lorelum/lorelum/pull/287)

For repository contributors, host Hook protocols and shared services have clearer internal boundaries; unused private `shared`/`mcp` placeholder packages and their unused dependencies were removed. No local MCP product surface is introduced or removed. Current OpenSpec capabilities were synchronized with implemented changes, and the PR template allows optional harness/model disclosure for aggregate statistics, not merge decisions. [#278](https://github.com/lorelum/lorelum/pull/278) [#281](https://github.com/lorelum/lorelum/pull/281) [#282](https://github.com/lorelum/lorelum/pull/282) [#283](https://github.com/lorelum/lorelum/pull/283)

## Upgrade notes

### CLI and host Plugins

From an alpha.5 CLI installed by the official installer at its default location, run `lore update` to review the available prerelease and `lore update --apply` to apply it explicitly. Other installation methods can check but must update through their managing method or the exact-version installer below. Alpha.4 and earlier do not provide `lore update`.

Update existing host Plugins through their host-native flows and start a new session. Plugin installation/update does not upgrade the CLI, Packs, or model. Pack versions remain independent. If an older Backend is still running, follow the error's guarded recovery sequence:

```sh
lore backend stop --if-idle
```

Only if the stop reports `stopped`, run `lore backend start`, then retry the original command. If stopping is deferred, finish or resolve the active work first; do not replace the guarded stop with an unconditional stop. See [troubleshooting](https://lorelum.com/en/docs/troubleshooting).

### JSON failure consumers: remove `error.recovery`

`error.recovery` is removed, without a compatibility alias. Branch on `error.code` and display the complete `error.message`; do not parse message prose as a machine protocol. Error codes, exit codes, applicable `resource` details, and `diagnostics.traceId` remain. Semantic success data adds `retrievalMethod`, which strict result decoders must accept. The process envelope still reports protocol version 2: check the installed `toolVersion` and `describe` schema when updating an integration. [#271](https://github.com/lorelum/lorelum/pull/271) [#279](https://github.com/lorelum/lorelum/pull/279)

### Derived semantic indexes rebuild; canonical Packs do not change

The semantic-index format and Profile identity change. Old derived vectors are not reused as though they matched the new input identities: the normal automatic build/rebuild path regenerates incompatible artifacts from canonical content. The first semantic query may therefore be preparing/indexing rather than immediately ready. No Pack reinstall, model redownload, or manual index-directory deletion is required. Methods keep separate derived artifacts; a failed rebuild does not roll back an installed Pack. [#279](https://github.com/lorelum/lorelum/pull/279)

### Integrity-check timing and configuration

Normal committed Store reads and resident encoding **no longer promise to detect arbitrary same-user file/database changes made outside Lorelum APIs on every call**. Use Pack source/update workflows to change installed content; full open/reindex, model preparation, publication, and recovery retain their checks. This validation change alone requires no data migration or cache clearing. Configuration edits made during an invocation take effect on the next invocation rather than mixing two document versions. [#285](https://github.com/lorelum/lorelum/pull/285) [#288](https://github.com/lorelum/lorelum/pull/288)

Compiled developer builds must use the repository build scripts, which inject the Backend build identity; bare `bun build --compile` is not a supported Backend build. Keep the matching native runtime beside the CLI.

Pack formats, LocalStore data, indexes, and retrieval remain alpha-stage contracts. Keep a backup or use an isolated `--store-root` when evaluating a release against shared knowledge data.

## Known limitations

- Experimental multi-view retrieval does not resolve all task-ranking, recall, or scope/applicability errors. Single-vector remains the default and retains the model's complete-input length limits. [#236](https://github.com/lorelum/lorelum/issues/236)
- Native batching does not establish that all embedding batch deadline/readiness problems are fixed. The recorded 97-Practice cold-build timeout is outside the ready-path performance table; [#243](https://github.com/lorelum/lorelum/issues/243) remains open. Follow the reported timeout and model recovery guidance rather than interpreting a failed build as an empty knowledge result.
- omp host-level validation covers macOS arm64, not Linux or Windows. Cursor, WorkBuddy, and ZCode cannot deliver child read-candidate hints through their host Hook contracts. Session read candidates are not proof of main-Agent-only reads. [#215](https://github.com/lorelum/lorelum/issues/215)
- Blog experiment results are local, finite evaluations; neither article establishes universal retrieval quality or Agent outcome gains.

## Install __RELEASE_TAG__

### macOS on Apple Silicon and Linux x64

```sh
curl -fsSL https://raw.githubusercontent.com/lorelum/lorelum/main/install.sh | sh -s -- --version __RELEASE_VERSION__
```

### Windows x64

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/lorelum/lorelum/main/install.ps1))) -Version __RELEASE_VERSION__
```

The installers download the matching archive and `SHA256SUMS`, verify the archive checksum, and install the complete release directory. On Windows, run the PowerShell command from an already-open session so any installer error remains visible.

## Downloads

Use the installers above for normal installation. These assets are available for manual or offline use:

- lore-__RELEASE_VERSION__-darwin-arm64.tar.gz — macOS on Apple Silicon
- lore-__RELEASE_VERSION__-linux-x64.tar.gz — Linux x64
- lore-__RELEASE_VERSION__-win32-x64.zip — Windows x64
- lore-__RELEASE_VERSION__-darwin-arm64.metadata.json
- lore-__RELEASE_VERSION__-linux-x64.metadata.json
- lore-__RELEASE_VERSION__-win32-x64.metadata.json
- SHA256SUMS — SHA-256 checksums for every archive and metadata file

macOS on Apple Silicon is Lorelum's priority platform and the most thoroughly validated release target. Linux x64 and Windows x64 are best-effort targets; compatibility and performance across every operating-system build, hardware configuration, and local security policy are not guaranteed.

## Full changelog

[Compare v0.1.0-alpha.5 to __RELEASE_TAG__](https://github.com/lorelum/lorelum/compare/v0.1.0-alpha.5...__RELEASE_TAG__)

## Verification boundary

The release workflow builds on macOS, Linux, and Windows, verifies archive and metadata checksums, unpacks each archive, checks CLI/native version commands, and exercises packaged Backend start/status on its matching runner. Those checks establish package integrity and basic lifecycle behavior, not cross-platform semantic quality or the performance claims above. Public installer smoke and exact workflow/commit results are recorded in the release-preparation PR.
