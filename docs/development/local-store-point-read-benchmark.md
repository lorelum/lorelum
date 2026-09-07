# LocalStore point-read benchmark

This benchmark compares four retrieval costs on the same isolated LocalStore at 100, 1,000, and 5,000 Practices. It is an observation tool, not a performance gate: machine load, filesystem cache, Bun version, and the compiled binary all affect absolute timings.

```sh
bun packages/engine/benchmarks/local-store-point-read.bench.ts
```

It reports p50, p95, and mean latency for:

- `sql-primary-key`: the SQLite primary-key lookup only.
- `sql-materialize-target`: the query plus the shared row materializer and its canonical/digest validation.
- `local-store-get`: the Engine point-read API, including manifest/SQLite consistency reads and journal handling.
- `open-then-find-baseline`: the previous shape of work—full cold open, artifact audit, full materialization, then an in-memory `find`.

Every scale is constructed in a new temporary root and removed afterwards. No default user Store is opened or modified. The command supports smaller, quicker exploratory runs without changing its default comparison set:

```sh
bun packages/engine/benchmarks/local-store-point-read.bench.ts --scales 100,1000 --iterations 10 --full-read-iterations 3 --warmup 2
```

To include end-to-end process startup and the public `lore get` command, compile the current CLI first and pass the resulting executable explicitly:

```sh
bun run build:cli
LORELUM_CLI_BINARY="$PWD/dist/lore" bun packages/engine/benchmarks/local-store-point-read.bench.ts
```

The compiled-CLI line is intentionally optional. It measures a different boundary from the in-process Engine calls (process startup, argument parsing, JSON serialization, and the point read), and it may be unavailable on a platform that cannot compile the CLI. When comparing revisions, record the Bun version, operating system, command-line options, and whether the CLI result was included; use identical scale, warmup, and iteration settings. Do not compare a persistent-index experiment against this request-local Store lifecycle without stating that change separately.

`compiled-cli-version-startup` runs `--version` as a startup-only reference; `compiled-cli-get-startup` includes the actual get operation. Their difference is not a precise isolated Engine measurement: they are separate processes with different work and scheduling noise.

## Recorded local baseline

Measured on 2026-09-07 (UTC), macOS arm64, Bun 1.3.8, at the point-read-only stage before registering keyword query. Command: `LORELUM_CLI_BINARY=dist/lore bun packages/engine/benchmarks/local-store-point-read.bench.ts --iterations 30 --full-read-iterations 20 --warmup 5`. Each cell below is p50 / p95 in milliseconds.

| Practices | Engine point read | Previous full-open + find | Compiled get | Compiled version reference |
| --- | --- | --- | --- | --- |
| 100 | 0.26 / 0.38 | 5.50 / 6.27 | 48.16 / 48.52 | 42.91 / 45.38 |
| 1,000 | 0.23 / 0.33 | 55.34 / 56.89 | 48.81 / 49.30 | 43.54 / 44.91 |
| 5,000 | 0.21 / 0.23 | 298.90 / 304.57 | 49.22 / 50.18 | 43.97 / 44.44 |

The joined SQL plus target materialization measured about 0.02 ms p50 at each scale; the minimal primary-key-only query was below the report's 0.01 ms precision. The query-plan regression test separately checks that the real joined point query searches both existing indexes rather than scanning either table.

These fixtures have one Pack, one source per Practice, short deterministic bodies, and warm filesystem caches after installation and warmup. They demonstrate removal of full-corpus work, not cold-disk performance, large-Pack-count behavior, retrieval quality, peak memory, or a cross-platform latency guarantee. Ordinary point reads still parse manifests and check journals; their total cost is not independent of Pack count. The full-open baseline deliberately includes the stronger artifact audit that point reads no longer promise. Future query benchmarks must measure their own corpus loading and indexing costs rather than reuse these point-read numbers.
