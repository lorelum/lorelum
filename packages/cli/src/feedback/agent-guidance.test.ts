import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const skills = [
  {
    path: "skills/lorelum/SKILL.md",
    recoveryReference: "skills/lorelum/references/semantic-query-recovery.md",
  },
  {
    path: "plugins/codex/lorelum/skills/lorelum/SKILL.md",
    recoveryReference: "plugins/codex/lorelum/skills/lorelum/references/semantic-query-recovery.md",
  },
  {
    path: "plugins/zcode/lorelum/skills/lorelum/SKILL.md",
    recoveryReference: "plugins/zcode/lorelum/skills/lorelum/references/semantic-query-recovery.md",
  },
  {
    path: "plugins/cursor/lorelum/skills/lorelum/SKILL.md",
    recoveryReference:
      "plugins/cursor/lorelum/skills/lorelum/references/semantic-query-recovery.md",
  },
  {
    path: "plugins/workbuddy/lorelum/skills/lorelum/SKILL.md",
    recoveryReference:
      "plugins/workbuddy/lorelum/skills/lorelum/references/semantic-query-recovery.md",
  },
] as const;

test("Skill keeps retrieval and resource actions while dispatching diagnostics to recovery", async () => {
  await Promise.all(
    skills.map(async ({ path, recoveryReference }) => {
      const [content, recovery] = await Promise.all([
        Bun.file(`${repositoryRoot}${path}`).text(),
        Bun.file(`${repositoryRoot}${recoveryReference}`).text(),
      ]);
      expect(content).toContain("lore pack list --details");
      expect(content).toContain("lore query ");
      expect(content).toContain("lore get <practice-id>");
      expect(content).toContain("lore pack list <pack-name>");
      expect(content).toContain("`packRoot` of its corresponding Store source");
      expect(content).toContain("`project-layer-N`");
      expect(content).toContain("diagnostics.traceId");
      expect(content).toContain("lore logs --trace-id <traceId>");
      expect(content).toContain("[semantic query recovery](references/semantic-query-recovery.md)");

      expect(recovery).toContain("missingEvidence");
      expect(recovery).toContain("Do not scan another trace");
      expect(recovery).toContain("Do not preflight Backend, model, index, or status");
      expect(recovery).toContain("new invocation, not evidence from the original failure");
      expect(recovery).toContain(
        "lore feedback draft --trace-id <traceId> --kind <bug|improvement>",
      );
      expect(recovery).toContain("long-running user task");
      expect(recovery).toContain("completion or another safe stopping point");
      expect(recovery).toContain("explicitly agrees to prepare a local draft");
      expect(recovery).toContain("do not create a draft");
      expect(recovery).toContain("never create feedback artifacts");
      expect(recovery).toContain(
        "complete retained same-trace `error`, `warn`, and `info` call chain",
      );
      expect(recovery).toContain("--include-logs info` is equivalent to the default");
      expect(recovery).toContain("debug-records-not-found");
      expect(recovery).toContain("separate explicit authorization");
      expect(recovery).toContain("credential-like or clearly sensitive content");
      expect(recovery).toContain("lore index build --json");
      expect(recovery).toContain("lore index operation <operation-id> --json");
    }),
  );
});
