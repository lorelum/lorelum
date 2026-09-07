import { expect, test } from "bun:test";

import { canonicalizePractice } from "../../local-store/model";
import { projectKeywordPractice } from "./projection";

test("projects the seven searchable fields without serializing reserved anti-pattern checks", () => {
  const canonical = canonicalizePractice({
    id: "platform.api",
    title: "Use the service layer",
    stage: "api",
    tech_stack: ["React", "TypeScript"],
    applies_when: "Calling a backend from the UI",
    body: "Do not fetch inside a component.",
    anti_patterns: [
      {
        id: "platform.fetch-in-ui",
        name: "Fetch in UI",
        description: "Direct request in a component.",
        check: { unstable: true },
      },
    ],
  });
  const document = projectKeywordPractice({
    practiceId: canonical.practice.id,
    contentDigest: canonical.contentDigest,
    canonicalContent: canonical.canonicalContent,
    practice: canonical.practice,
    sources: [],
  });

  expect(document).toEqual({
    practiceId: "platform.api",
    contentDigest: canonical.contentDigest,
    id: "platform.api",
    title: "Use the service layer",
    appliesWhen: "Calling a backend from the UI",
    techStack: "React TypeScript",
    stage: "api",
    antiPatterns: "platform.fetch-in-ui Fetch in UI Direct request in a component.",
    body: "Do not fetch inside a component.",
  });
  expect(JSON.stringify(document)).not.toContain("unstable");
});
