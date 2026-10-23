import assert from "node:assert/strict";
import { verifyProjectContextNativeScenario } from "./scenarios/project-context-native.js";
import { verifyRetrievalMethodsNativeScenario } from "./scenarios/retrieval-methods-native.js";
import { verifyInstallNativeScenario } from "./scenarios/install-native.js";
import { verifyEmptyQueryNativeScenario } from "./scenarios/empty-query-native.js";
import { createNativeSmokeEnvironment } from "./support/native-smoke.js";

const modelPath = process.argv[2];
assert(
  modelPath,
  "Usage: bun packages/cli/integration/project-context-native-smoke.integration.ts /absolute/path/to/granite-q4_0.gguf [all|project-context|retrieval-methods|install|empty-query]",
);
const selection = process.argv[3] ?? "all";
assert(
  ["all", "project-context", "retrieval-methods", "install", "empty-query"].includes(selection),
  `Unknown native smoke scenario: ${selection}`,
);

const environment = await createNativeSmokeEnvironment(modelPath);
try {
  const projectContext =
    selection === "all" || selection === "project-context"
      ? await verifyProjectContextNativeScenario(environment)
      : undefined;
  const retrievalMethods =
    selection === "all" || selection === "retrieval-methods"
      ? await verifyRetrievalMethodsNativeScenario(environment)
      : undefined;
  const install =
    selection === "all" || selection === "install"
      ? await verifyInstallNativeScenario(environment)
      : undefined;
  const emptyQuery =
    selection === "all" || selection === "empty-query"
      ? await verifyEmptyQueryNativeScenario(environment)
      : undefined;
  console.log(
    JSON.stringify({
      scenario: "project-context-native-smoke",
      status: "passed",
      scenarios: [
        ...(projectContext ? ["project-context"] : []),
        ...(retrievalMethods ? ["retrieval-methods"] : []),
        ...(install ? ["install"] : []),
        ...(emptyQuery ? ["empty-query"] : []),
      ],
      fixture: {
        ...projectContext?.fixture,
        retrievalMethodPractices: retrievalMethods?.fixture.totalPractices,
        ...install?.fixture,
      },
      observations: {
        ...projectContext?.observations,
        ...retrievalMethods?.observations,
        ...install?.observations,
        ...emptyQuery?.observations,
        documentBatches: environment.encodingStats().batches,
        nativeBatchSizes: environment.encodingStats().nativeBatchSizes,
        downloadRequests: environment.downloadRequests(),
      },
    }),
  );
} finally {
  await environment.dispose();
}
