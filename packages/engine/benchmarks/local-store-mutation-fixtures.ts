import { createPackCandidate } from "../src/local-store/model";

export function createTargetCandidate(version: "1.0.0" | "1.0.1") {
  const body = version === "1.0.0" ? "Initial target guidance.\n" : "Changed target guidance.\n";
  return createPackCandidate(
    {
      pack: { name: "benchmark-target", version },
      practices: [
        {
          id: "benchmark.mutation.target",
          title: "Mutation target",
          stage: "implementation",
          tech_stack: ["typescript"],
          applies_when: "Measuring one LocalStore mutation",
          body,
        },
      ],
      decisions: [],
    },
    { "benchmark.mutation.target": "practices/target.md" },
  ).candidate;
}
