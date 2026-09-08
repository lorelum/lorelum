# Keyword query: quality and performance baseline

This records the request-local baseline from the [LocalStore read-and-query foundation](../plans/local-store-read-and-query-foundation.md), not a comparison with MiniSearch or semantic retrieval. Issue #63 adds a persistent derived FTS5 index; its benchmark now reports `query-first-build` and `query-reuse` separately. Both scripts use isolated temporary Stores and remove them afterwards. They never open the user's default Store. No external Pack content is checked into this repository.

## Reproduce

From the repository root:

```sh
bun run build:cli
LORELUM_CLI_BINARY=dist/lore bun packages/engine/benchmarks/keyword-query.bench.ts
bun packages/engine/benchmarks/keyword-query-quality.bench.ts
```

The performance script defaults to fixed seed 42, 100 / 1,000 / 5,000 / 20,000 Practices, and 20 measured samples per stage. Each synthetic Practice has one source, one of four topics, and a deterministic variable-length body. `query-first-build` removes the derived index before every sample; `query-reuse` warms it once and measures cross-process-reusable in-process queries. The incremental sequence installs one unique single-Practice Pack per sample, then reports `incremental-install`, `query-delta-update`, and `query-delta-reuse`; set `LORELUM_BENCH_INCREMENTAL_ITERATIONS` independently when needed. Compiled queries run in fresh processes after the steady-state warmup. Filesystem caches are warm, so this is not a cold-disk benchmark.

For a quick run, set `LORELUM_BENCH_SCALES=100,1000` and `LORELUM_BENCH_ITERATIONS=5`. For a public Pack, set `LORELUM_BENCH_PACK` to its local directory and optionally set `LORELUM_BENCH_QUERY`. The recorded public input was the 30-Practice `agentic-coding` Pack from `lorelum/lorelum-packs`, commit `4e0ba43d4274c4908c3eb6bf178ec666980f49ea`. Acquire that exact revision in a temporary checkout before reproducing:

```sh
LORELUM_BENCH_PACK=/path/to/lorelum-packs/packs/agentic-coding \
LORELUM_BENCH_QUERY='classify failing test' \
LORELUM_CLI_BINARY=dist/lore \
bun packages/engine/benchmarks/keyword-query.bench.ts

LORELUM_BENCH_PACK=/path/to/lorelum-packs/packs/agentic-coding \
bun packages/engine/benchmarks/keyword-query-quality.bench.ts
```

The quality script's external labels intentionally target that Pack. It rejects an input where a labeled Practice is missing, instead of silently evaluating a different corpus. Scripts do not download anything automatically.

## Latency and memory

Observed on 2026-09-07 UTC, macOS arm64, Bun 1.3.8, before the persistent index implementation. Each latency cell is **p50 / p95 in milliseconds**; memory is the maximum child-process peak RSS across 20 compiled runs, reported by Bun in bytes and converted to MiB here.

| Practices | Store read | Tokenize + build + close | Search / top-k | Request-local QueryService | Compiled query | Peak RSS (MiB) |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 1.72 / 2.19 | 3.19 / 3.91 | 0.03 / 0.04 | 4.94 / 5.63 | 57.14 / 65.81 | 65.4 |
| 1,000 | 15.33 / 16.94 | 31.21 / 31.38 | 0.23 / 0.25 | 48.44 / 50.15 | 108.24 / 109.54 | 113.8 |
| 5,000 | 78.24 / 80.19 | 157.97 / 159.26 | 1.18 / 1.20 | 246.59 / 253.69 | 302.29 / 307.96 | 173.7 |
| 20,000 | 314.84 / 322.80 | 636.33 / 645.41 | 4.74 / 4.86 | 989.43 / 1002.05 | 1026.97 / 1048.63 | 420.9 |
| Public Pack (30) | 1.57 / 1.99 | 5.74 / 6.87 | 0.03 / 0.04 | 7.50 / 8.49 | 60.80 / 63.62 | 70.6 |

Pure projection p50 / p95 was 0.01 / 0.02 ms, 0.13 / 0.14 ms, 0.65 / 0.88 ms, and 3.70 / 5.23 ms for the four synthetic sizes; the public Pack was 0.01 / 0.02 ms. QueryService total also includes result assembly. The script reports means as well: at 100 Practices the compiled mean was 88.85 ms, noticeably above its median because of a startup outlier. No samples were discarded. Separate stage medians are not additive measurements of the same invocation.

The baseline scaling cost is full-corpus materialization plus request-local index construction, not just the SQL top-k search. At 20,000 Practices this is about one second and 421 MiB peak RSS in this environment; it is not a claim of low-latency behavior at arbitrary scale. The persistent index implementation must be assessed against this baseline with its separate first-build, unchanged-reuse, and revision-delta-update stages; no product latency or memory budget is inferred from this table.

## Persistent index verification

Observed on 2026-09-08 UTC, macOS arm64, Bun 1.3.8, compiled CLI from the current worktree. These runs use the same fixed synthetic generator and queries as the baseline. `First build` removes `indexes/` before every sample; `reuse` keeps a matching index. The 20,000-Practice first-build/reuse group has five samples because the full 20-sample group exceeded the local one-command execution window; it is a verification result, not the final acceptance measurement.

| Corpus | Samples | First build p50 / p95 ms | Reuse p50 / p95 ms | Compiled reuse p50 / p95 ms | Peak RSS MiB |
| --- | --- | --- | --- | --- | --- |
| 1,000 synthetic | 20 | 63.55 / 80.19 | 1.78 / 3.45 | 68.31 / 74.19 | 51.8 |
| 5,000 synthetic | 20 | 276.94 / 283.83 | 4.48 / 5.38 | 63.44 / 67.63 | 54.4 |
| 20,000 synthetic | 5 | 1100.19 / 1132.72 | 16.02 / 16.64 | 70.08 / 71.54 | 59.3 |
| agentic-coding, 30 Practices | 20 | 11.56 / 12.77 | 1.08 / 1.30 | 56.06 / 56.66 | 51.3 |

### Incremental update verification

Observed on the same machine with five unique one-Practice Pack installs per corpus. `incremental-install` is reported separately because the current LocalStore mutation path rewrites its complete canonical SQLite derived state. `query-delta-update` starts after that commit and measures only the subsequent revision-log-driven FTS synchronization plus query.

| Corpus | Samples | Incremental install p50 / p95 ms | Delta query p50 / p95 ms | Delta reuse p50 / p95 ms |
| --- | --- | --- | --- | --- |
| 1,000 synthetic | 5 | 121.21 / 126.40 | 3.69 / 9.51 | 1.03 / 1.58 |
| 5,000 synthetic | 5 | 595.80 / 610.51 | 9.41 / 9.93 | 1.19 / 1.38 |
| 20,000 synthetic | 5 | 2459.93 / 2478.51 | 11.28 / 19.75 | 1.47 / 1.64 |

The FTS update therefore scales with the changed Practice, not the corpus: it stays below 20ms p95 at 20,000 Practices. The increasing install time is a separate LocalStore lifecycle cost and is not solved by this index work. Improving it requires a distinct design to stop `writeDerivedState()` from replacing the complete canonical projection per mutation.

The successive install/query integration test separately proves that, after its initial build, each normal mutation is applied from one revision delta and does not call the full-corpus snapshot method. The performance script reports the corresponding in-process latency stages; a 100-cycle compiled benchmark remains required before treating this table as the issue's final performance acceptance record.

The first 20,000-Practice run exposed an existing sibling-file recursion overflow while installing the fixture. Artifact enumeration and hashing now use loops without changing sorted path-NUL-content-LF digest encoding. A separate 20,000-file regression independently checks the digest. The table records the completed run after that correction.

## Retrieval quality

The quality script uses small, hand-labeled diagnostic cases. It reports Recall@5 (fraction of labeled relevant IDs retrieved), reciprocal rank of the first relevant result, binary nDCG@5, and whether a specifically labeled out-of-scope candidate appeared. The averages below are **not** production quality estimates: labels are deliberately narrow, lexical queries overlap known content, and the scope/cross-language groups contain only one case each.

| Corpus / case group | Cases | Recall@5 | MRR@5 | nDCG@5 | Labeled scope violation |
| --- | --- | --- | --- | --- | --- |
| Repository React fixture + Chinese fixture, lexical | 6 | 1.00 | 1.00 | 1.00 | Not evaluated |
| Same fixture, Chinese query against English guidance | 1 | 0.00 | 0.00 | 0.00 | Not evaluated |
| Public agentic-coding Pack, lexical | 4 | 1.00 | 1.00 | 1.00 | Not evaluated |
| Public Pack, review-only scope case | 1 | 1.00 | 1.00 | 1.00 | 0 / 1 |
| Public Pack, Chinese query against English guidance | 1 | 0.00 | 0.00 | 0.00 | Not evaluated |

The cross-language failures are retained in the baseline. Same-language Chinese token matching works; that does not translate a Chinese question into English guidance. Similarly, the one scope case succeeding does not mean BM25 understands negation or applicability. Results are candidates to inspect, not an assertion that every returned Practice should be followed.

The initial field weights are covered by ranking regressions, but they were not optimized against a held-out corpus. Broader labels, multilingual cases, long bodies, and FTS5/MiniSearch comparisons remain the research in issue #57. This delivery supplies executable measurements, not a claim that that research has already been completed.

## Verification boundary

Unit tests cover request rules, tokenization, real FTS5 ranking, literal MATCH encoding, deterministic ties, build/search/assembly failure cleanup, and concurrent-root isolation. Store tests check one-snapshot assembly, content changes, no persistent FTS tables, and no hidden journal convergence. Process integration compiles the CLI and runs Chinese and literal-token searches followed by `get` with matching ID and digest. These were run locally on macOS; other target platforms must run the same tests before claiming platform verification.
