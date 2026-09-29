import type { JsonValue } from "../output/protocol.js";
import { renderStructuredText } from "../output/structured-text.js";

interface GetTextData {
  readonly practice: {
    readonly id: string;
    readonly title: string;
    readonly tech_stack: readonly string[];
    readonly applies_when: string;
    readonly severity: string;
    readonly body: string;
    readonly anti_patterns: readonly {
      readonly name: string;
      readonly description: string;
      readonly severity: string;
    }[];
  };
  readonly sources: readonly {
    readonly packName: string;
    readonly sourcePath: string;
    readonly packRoot: string;
  }[];
}

/** Keep every source locator alongside the complete body, independent of link detection. */
export function renderGetDecisionText(data: JsonValue): string {
  const { practice, sources } = data as unknown as GetTextData;
  return renderStructuredText({
    practice: {
      id: practice.id,
      title: practice.title,
      ...(practice.tech_stack.length === 0 ? {} : { tech_stack: practice.tech_stack }),
      applies_when: practice.applies_when,
      ...(practice.severity === "warn" ? {} : { severity: practice.severity }),
      body: practice.body,
      ...(practice.anti_patterns.length === 0
        ? {}
        : {
            anti_patterns: practice.anti_patterns.map(({ name, description, severity }) => ({
              name,
              description,
              ...(severity === "warn" ? {} : { severity }),
            })),
          }),
    },
    sources: sources.map(({ packName, sourcePath, packRoot }) => ({
      packName,
      sourcePath,
      packRoot,
      ...(isProjectLayer(packRoot)
        ? { rootKind: "logical project provenance; not a filesystem path" }
        : {}),
    })),
  });
}

function isProjectLayer(root: string): boolean {
  return /^project-layer-\d+$/u.test(root);
}
