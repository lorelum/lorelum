import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { guidanceProfiles } from "./profiles.ts";
import { renderGuidance, type GuidanceSources } from "./render.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readSources(): Promise<GuidanceSources> {
  const [skillTemplate, recovery] = await Promise.all([
    readFile(`${repositoryRoot}/scripts/skill-guidance/content/skill.md.tmpl`, "utf8"),
    readFile(`${repositoryRoot}/scripts/skill-guidance/content/recovery.md`, "utf8"),
  ]);
  return { skillTemplate, recovery };
}

function renderedTargets(sources: GuidanceSources) {
  return Object.entries(guidanceProfiles).map(
    ([target, profile]) => [target, renderGuidance(sources, profile)] as const,
  );
}

test("shared retrieval and recovery guidance is present for every profile", async () => {
  const targets = renderedTargets(await readSources());
  for (const [, rendered] of targets) {
    expect(rendered.skill.startsWith("---\nname: lorelum\n")).toBe(true);
    expect(rendered.skill).toContain("lore pack list --details");
    expect(rendered.skill).toContain("lore query ");
    expect(rendered.skill).toContain("lore get <practice-id>");
    expect(rendered.skill).toContain("lore pack list <pack-name>");
    expect(rendered.skill).toContain("`packRoot` of its corresponding Store source");
    expect(rendered.skill).toContain("`project-layer-N`");
    expect(rendered.skill).toContain("diagnostics.traceId");
    expect(rendered.skill).toContain("lore logs --trace-id <traceId>");
    expect(rendered.skill).toContain(
      "[semantic query recovery](references/semantic-query-recovery.md)",
    );
    expect(rendered.skill).toContain("If a multi-step task needs");
    expect(rendered.skill).toContain("lore backend lease acquire");
    expect(rendered.skill).toContain("lore backend lease renew <lease-id>");
    expect(rendered.skill).toContain("lore backend lease release <lease-id>");

    expect(rendered.recovery).toContain("Reuse a visible Catalog during recovery");
    expect(rendered.recovery).toContain("missingEvidence");
    expect(rendered.recovery).toContain("Do not scan another trace");
    expect(rendered.recovery).toContain("Do not preflight Backend, model, index, or status");
    expect(rendered.recovery).toContain("new invocation, not evidence from the original failure");
    expect(rendered.recovery).toContain(
      "lore feedback draft --trace-id <traceId> --kind <bug|improvement>",
    );
    expect(rendered.recovery).toContain("long-running user task");
    expect(rendered.recovery).toContain("completion or another safe stopping point");
    expect(rendered.recovery).toContain("explicitly agrees to prepare a local draft");
    expect(rendered.recovery).toContain("do not create a draft");
    expect(rendered.recovery).toContain("never create feedback artifacts");
    expect(rendered.recovery).toContain(
      "complete retained same-trace `error`, `warn`, and `info` call chain",
    );
    expect(rendered.recovery).toContain("--include-logs info` is equivalent to the default");
    expect(rendered.recovery).toContain("debug-records-not-found");
    expect(rendered.recovery).toContain("separate explicit authorization");
    expect(rendered.recovery).toContain("credential-like or clearly sensitive content");
    expect(rendered.recovery).toContain("lore index build --json");
    expect(rendered.recovery).toContain("lore index operation <operation-id> --json");
    expect(rendered.recovery).toContain("lore backend stop --if-idle");
    expect(rendered.recovery).toContain('only after `state: "stopped"`');
    expect(rendered.recovery).toContain("do not retry in the background");
    expect(rendered.recovery).not.toContain("error.recovery");
    expect(rendered.recovery).not.toContain("backoff");
  }
});

test("generic and traditional host Skills share one body and lease rule", async () => {
  const ordinaryBodies = renderedTargets(await readSources())
    .filter(([target]) => target !== "omp")
    .map(([, rendered]) => rendered.skill.replace(/^description: .*$/m, "description: <metadata>"));

  expect(new Set(ordinaryBodies).size).toBe(1);
  expect(ordinaryBodies[0]).toContain("## Keep Backend available for a long task");
});

test("only omp receives its Catalog and read-hint additions", async () => {
  const targets = renderedTargets(await readSources());
  const omp = targets.find(([target]) => target === "omp");
  const generic = targets.find(([target]) => target === "generic");
  if (!omp || !generic) throw new Error("Expected generic and omp profiles.");

  expect(omp[1].skill).toContain(
    "task/eval children do not by default (`agent.subagentPackCatalog: false`)",
  );
  expect(omp[1].skill).toContain(
    "Do not run `lore pack list --details` merely because a child has no Catalog",
  );
  expect(omp[1].skill).toContain("Read-Practice hints in an omp child");
  expect(omp[1].skill).toContain(
    "`agent.subagentPackCatalog: true` adds only Pack routing metadata",
  );
  expect(generic[1].skill).not.toContain("task/eval children");
  expect(generic[1].skill).not.toContain("Read-Practice hints in an omp child");

  const allRecoveries = targets.map(([, rendered]) => rendered.recovery);
  expect(new Set(allRecoveries).size).toBe(1);
});

test("a shared source change reaches every rendered target", async () => {
  const original = await readSources();
  const changedSources: GuidanceSources = {
    skillTemplate: original.skillTemplate.replace(
      "For a material engineering decision",
      "SHARED-SOURCE-CHANGE For a material engineering decision",
    ),
    recovery: original.recovery.replace("missingEvidence", "sharedMissingEvidence"),
  };

  const targets = renderedTargets(changedSources);
  expect(targets.length).toBe(Object.keys(guidanceProfiles).length);
  for (const [, rendered] of targets) {
    expect(rendered.skill).toContain("SHARED-SOURCE-CHANGE For a material engineering decision");
    expect(rendered.recovery).toContain("sharedMissingEvidence");
  }
});

test("template rejects missing, duplicated, and unknown fixed slots", async () => {
  const sources = await readSources();
  const profile = guidanceProfiles.generic;

  expect(() =>
    renderGuidance(
      {
        ...sources,
        skillTemplate: sources.skillTemplate.replace("{{description}}", ""),
      },
      profile,
    ),
  ).toThrow("exactly one {{description}} slot");
  expect(() =>
    renderGuidance(
      {
        ...sources,
        skillTemplate: sources.skillTemplate.replace(
          "{{description}}",
          "{{description}} {{description}}",
        ),
      },
      profile,
    ),
  ).toThrow("exactly one {{description}} slot");
  expect(() =>
    renderGuidance(
      {
        ...sources,
        skillTemplate: `${sources.skillTemplate}\n{{futureSlot}}`,
      },
      profile,
    ),
  ).toThrow("unknown slot: {{futureSlot}}");
});

test("rendering is deterministic, LF-normalized, and independent of checkout paths", async () => {
  const sources = await readSources();
  const noisySources = {
    skillTemplate: `${sources.skillTemplate.replace(/\n/g, "\r\n")}\r\n\r\n`,
    recovery: `${sources.recovery.replace(/\n/g, "\r\n")}\r\n\r\n`,
  };
  const first = renderGuidance(noisySources, guidanceProfiles.generic);
  const second = renderGuidance(noisySources, guidanceProfiles.generic);

  expect(first).toEqual(second);
  for (const content of [first.skill, first.recovery]) {
    expect(content).not.toMatch(/\r/);
    expect(content.endsWith("\n")).toBe(true);
    expect(content.endsWith("\n\n")).toBe(false);
    expect(content).not.toContain(repositoryRoot);
    expect(content).not.toMatch(/\/(?:Users|home)\//);
  }
});
