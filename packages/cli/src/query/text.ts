import type { JsonValue } from "../output/protocol.js";
import { renderStructuredText } from "../output/structured-text.js";

interface QueryTextContext {
  readonly state: "ready" | "degraded";
  readonly warnings: readonly {
    readonly code: string;
    readonly layerDepth: number;
    readonly packName?: string;
    readonly practiceId?: string;
  }[];
}

interface QueryTextHit {
  readonly practiceId: string;
  readonly title: string;
  readonly stage: string;
  readonly techStack: readonly string[];
  readonly appliesWhen: string;
  readonly severity: string;
}

interface QueryTextData {
  readonly state?: "preparing" | "indexing";
  readonly mode?: "semantic" | "keyword";
  readonly coverage?: "complete" | "partial";
  readonly operationId?: string;
  readonly indexedPracticeCount?: number;
  readonly totalPracticeCount?: number;
  readonly message?: string;
  readonly results?: readonly QueryTextHit[];
  readonly context?: QueryTextContext;
}

/** The command constructs complete query data before selecting this text view. */
export function renderQueryDecisionText(data: JsonValue): string {
  const result = data as QueryTextData;
  const context =
    result.context?.state === "degraded" || (result.context?.warnings.length ?? 0) > 0
      ? { context: result.context }
      : {};

  if (result.state === "preparing") {
    return renderStructuredText({ state: result.state, message: result.message, ...context });
  }
  if (result.state === "indexing") {
    return renderStructuredText({
      state: result.state,
      operationId: result.operationId,
      indexedPracticeCount: result.indexedPracticeCount,
      totalPracticeCount: result.totalPracticeCount,
      message: result.message,
      ...context,
    });
  }
  return renderStructuredText({
    ...(result.mode === "keyword" ? { mode: result.mode } : {}),
    ...(result.coverage === "partial"
      ? {
          coverage: result.coverage,
          ...(result.indexedPracticeCount === undefined || result.totalPracticeCount === undefined
            ? {}
            : {
                indexedPracticeCount: result.indexedPracticeCount,
                totalPracticeCount: result.totalPracticeCount,
              }),
        }
      : {}),
    results: result.results?.map((hit) => ({
      practiceId: hit.practiceId,
      title: hit.title,
      stage: hit.stage,
      ...(hit.techStack.length === 0 ? {} : { techStack: hit.techStack }),
      appliesWhen: hit.appliesWhen,
      ...(hit.severity === "warn" ? {} : { severity: hit.severity }),
    })),
    ...context,
  });
}
