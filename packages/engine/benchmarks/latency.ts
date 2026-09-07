export interface LatencySummary {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly meanMs: number;
}

export function summarize(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (p: number): number => {
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
    return sorted[index] ?? 0;
  };
  return {
    samples: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    meanMs: sorted.reduce((total, sample) => total + sample, 0) / sorted.length,
  };
}

export async function measure(
  iterations: number,
  warmup: number,
  operation: () => void | Promise<void>,
): Promise<LatencySummary> {
  for (let index = 0; index < warmup; index++) {
    // eslint-disable-next-line no-await-in-loop -- each invocation must be individually timed later
    await operation();
  }
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- each invocation is one latency sample
    await operation();
    samples.push(performance.now() - startedAt);
  }
  return summarize(samples);
}
