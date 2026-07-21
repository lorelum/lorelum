import type { PackInput } from "../validate";

import { layeredDesignPractice } from "./layered-design";

/**
 * Seed pack — a complete valid PackInput for happy-path testing.
 *
 * Factory function (not a constant): tests mutate the returned object, so
 * each call must produce a fresh copy. Three practices (≥3 to avoid the
 * small-pack info) + one decision whose branch recommends an existing
 * practice. Practice[0] is the layered-design seed; [1]/[2] are minimal
 * valid siblings with distinct ids and titles (the duplicate-id and
 * similar-practice tests mutate them to collide).
 */
export function reactPack(): PackInput {
  return {
    pack: { name: "react-fullstack", version: "0.1.0" },
    practices: [
      {
        ...layeredDesignPractice,
        anti_patterns: layeredDesignPractice.anti_patterns?.map((a) => ({ ...a })),
      },
      {
        id: "react.state.redux",
        title: "Redux for heavy state",
        stage: "state",
        tech_stack: ["react"],
        applies_when: "managing heavy client-side state at scale",
        severity: "warn",
        body: "Use redux when state is large.",
      },
      {
        id: "react.auth.guard",
        title: "Route guard for auth",
        stage: "auth",
        tech_stack: ["react"],
        applies_when: "protecting routes that require authentication",
        severity: "warn",
        body: "Wrap protected routes.",
      },
    ],
    decisions: [
      {
        id: "state.client-vs-server",
        question: "How much client state?",
        branches: [
          { when: "heavy client state", recommend: ["react.state.redux"], reason: "Redux scales" },
        ],
      },
    ],
  };
}
