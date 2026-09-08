# LocalStore mutation benchmark

This is the reproducible lifecycle benchmark for [Issue #79](https://github.com/lorelum/lorelum/issues/79), following the incremental projection change in [Issue #73](https://github.com/lorelum/lorelum/issues/73). It measures one-Practice `add`, `change`, and `remove` mutations against 1,000, 5,000, and 20,000 Practice baselines.

It deliberately uses a small **compiled internal runner**, not the public `lore` CLI. The public CLI has no offline upgrade or uninstall contract, while this benchmark needs deterministic fixture inputs and all three lifecycle operations without Registry or Git access. The runner imports Engine lifecycle internals only; it does not add a CLI command or change CLI JSON, MCP, or Pack contracts.

Build the runner from the repository root, then pass its path explicitly:

```sh
bun build --compile packages/engine/benchmarks/local-store-mutation-runner.ts \
  --outfile dist/lorelum-mutation-bench-runner
LORELUM_MUTATION_BENCH_RUNNER=dist/lorelum-mutation-bench-runner \
  bun packages/engine/benchmarks/local-store-mutation.bench.ts
```

The default run uses 20 measured samples and 3 warmups for every scale and operation. For a quicker exploratory run, override only the relevant environment variables:

```sh
LORELUM_MUTATION_BENCH_RUNNER=dist/lorelum-mutation-bench-runner \
LORELUM_BENCH_SCALES=1000 \
LORELUM_BENCH_ITERATIONS=5 \
LORELUM_BENCH_WARMUP=1 \
  bun packages/engine/benchmarks/local-store-mutation.bench.ts
```

The driver constructs one isolated source template Store for each `(scale, operation)` pair, then clones it into a new temporary root per child. Template construction, cloning, and removal are outside the measured interval. Each timed sample starts immediately before launching the compiled runner and ends after that child completes one lifecycle mutation and emits its result. Thus latency includes compiled-process startup and the mutation itself, but not baseline preparation.

Each JSON result includes p50/p95/mean latency, the maximum `maxRSS` reported by Bun across the measured children, and stable internal logical counters. `logicalMetrics` count SQLite rows returned or changed by the lifecycle's bounded reads and writes, plus Effective Practice/source rows materialized for reconciliation. They are implementation counters, not SQLite page reads, WAL bytes, file-size deltas, kernel I/O, or an externally supported Engine/CLI field. The driver rejects a result set whose logical counters vary between otherwise identical samples.

Record the Bun version, operating system, architecture, command, scale, warmup, and iteration count beside any comparison. These deterministic fixtures use one base Pack with one short source per Practice and a separate one-Practice target Pack. They demonstrate lifecycle work after a warm Store baseline; they do not establish cold-disk behavior, many-Pack behavior, Registry/Git installation cost, FTS delta-update cost, or a cross-platform latency/memory guarantee. FTS lifecycle measurement remains in the [keyword-query benchmark](./keyword-query-benchmark.md).

## Recorded local baseline

Measured on 2026-09-09 (Asia/Shanghai), macOS arm64, Bun 1.3.8. Command: `LORELUM_MUTATION_BENCH_RUNNER=dist/lorelum-mutation-bench-runner bun packages/engine/benchmarks/local-store-mutation.bench.ts`. Each cell is p50 / p95 in milliseconds; RSS is the maximum child `maxRSS` across 20 measured samples, converted from the JSON byte value to MiB.

| Baseline Practices | Add | Change | Remove |
| --- | --- | --- | --- |
| 1,000 | 38.21 / 53.88 ms, 42.72 MiB | 37.65 / 38.69 ms, 42.34 MiB | 35.37 / 36.61 ms, 41.05 MiB |
| 5,000 | 38.42 / 39.04 ms, 42.06 MiB | 39.74 / 51.81 ms, 42.45 MiB | 36.92 / 64.15 ms, 41.05 MiB |
| 20,000 | 41.88 / 53.43 ms, 42.19 MiB | 41.82 / 42.66 ms, 42.28 MiB | 39.84 / 49.03 ms, 41.30 MiB |

The stable logical counters are identical at all three sizes: add materializes no existing Practice/source row and writes one active-Pack, Effective Practice, source, metadata, and revision-log row. Change materializes one Effective Practice and source, then writes two Effective Practice/source rows because the target row is replaced. Remove materializes one Effective Practice and source, then writes one replacement/delete row in each affected projection table. The full JSON output preserves the exact per-table counters; the table summarizes only latency and RSS.
