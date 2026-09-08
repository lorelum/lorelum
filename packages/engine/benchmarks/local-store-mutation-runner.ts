import { installOrUpgrade } from "../src/local-store/lifecycle/install";
import { uninstallPack } from "../src/local-store/lifecycle/uninstall";
import { createMutationMetrics } from "../src/local-store/storage/sqlite/mutation-metrics";
import { createTargetCandidate } from "./local-store-mutation-fixtures";

type Operation = "add" | "change" | "remove";

function parseArgs(argv: readonly string[]): {
  readonly rootPath: string;
  readonly operation: Operation;
} {
  let rootPath: string | undefined;
  let operation: Operation | undefined;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--root" && value !== undefined) {
      rootPath = value;
      index += 1;
    } else if (
      flag === "--operation" &&
      (value === "add" || value === "change" || value === "remove")
    ) {
      operation = value;
      index += 1;
    } else {
      throw new Error("Usage: --root <path> --operation add|change|remove");
    }
  }
  if (rootPath === undefined || operation === undefined) {
    throw new Error("Usage: --root <path> --operation add|change|remove");
  }
  return Object.freeze({ rootPath, operation });
}

const { rootPath, operation } = parseArgs(Bun.argv.slice(2));
const metrics = createMutationMetrics();
const result =
  operation === "add"
    ? await installOrUpgrade(
        rootPath,
        createTargetCandidate("1.0.0"),
        "install",
        undefined,
        [],
        metrics,
      )
    : operation === "change"
      ? await installOrUpgrade(
          rootPath,
          createTargetCandidate("1.0.1"),
          "upgrade",
          undefined,
          [],
          metrics,
        )
      : await uninstallPack(rootPath, "benchmark-target", undefined, metrics);

if (
  (operation === "add" && result.delta.added.length !== 1) ||
  (operation === "change" && result.delta.changed.length !== 1) ||
  (operation === "remove" && result.delta.invalidated.length !== 1)
) {
  throw new Error("benchmark mutation did not produce its expected Effective Practice delta");
}

console.log(
  JSON.stringify({
    operation,
    generation: result.generation,
    effectiveRevision: result.effectiveRevision,
    metrics: metrics.snapshot(),
  }),
);
