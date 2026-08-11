/** Minimal decisions.yaml fixture: one Decision Node with a heavy-client branch. */
export const clientVsServerYaml = [
  "- id: state.client-vs-server",
  "  question: How much client state?",
  "  branches:",
  "    - when: 'state.client == \"heavy\"'",
  "      recommend: [react.state.redux]",
  "      reason: Redux scales",
  "",
].join("\n");
