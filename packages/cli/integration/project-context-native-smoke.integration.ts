import assert from "node:assert/strict";
import { verifyProjectContextNativeScenario } from "./scenarios/project-context-native.js";
import { verifyRetrievalMethodsNativeScenario } from "./scenarios/retrieval-methods-native.js";
import { createNativeSmokeEnvironment } from "./support/native-smoke.js";

const modelPath = process.argv[2];
assert(
  modelPath,
  "Usage: bun packages/cli/integration/project-context-native-smoke.integration.ts /absolute/path/to/granite-q4_0.gguf [all|project-context|retrieval-methods]",
);
const selection = process.argv[3] ?? "all";
assert(
  ["all", "project-context", "retrieval-methods"].includes(selection),
  `Unknown native smoke scenario: ${selection}`,
);

const environment = await createNativeSmokeEnvironment(modelPath);
try {
  const projectContext =
    selection !== "retrieval-methods"
      ? await verifyProjectContextNativeScenario(environment)
      : undefined;
  const retrievalMethods =
    selection !== "project-context"
      ? await verifyRetrievalMethodsNativeScenario(environment)
      : undefined;
  console.log(
    JSON.stringify({
      scenario: "project-context-native-smoke",
      status: "passed",
      scenarios: [
        ...(projectContext ? ["project-context"] : []),
        ...(retrievalMethods ? ["retrieval-methods"] : []),
      ],
      fixture: {
        ...projectContext?.fixture,
        retrievalMethodPractices: retrievalMethods?.fixture.totalPractices,
      },
      observations: {
        ...projectContext?.observations,
        ...retrievalMethods?.observations,
        documentBatches: environment.encodingStats().batches,
        downloadRequests: environment.downloadRequests(),
      },
    }),
  );
} finally {
  await environment.dispose();
}
