import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readSkill(): Promise<string> {
  return readFile(join(import.meta.dir, "../skills/lorelum/SKILL.md"), "utf8");
}

async function readRecoveryReference(): Promise<string> {
  return readFile(
    join(import.meta.dir, "../skills/lorelum/references/semantic-query-recovery.md"),
    "utf8",
  );
}

test("reuses an injected Catalog and lists only once when it is absent", async () => {
  const skill = await readSkill();

  expect(skill).toContain("Installed Pack Catalog");
  expect(skill).toContain("lore pack list --details` once");
  expect(skill).toMatch(/do not run it merely because a task started/i);
  expect(skill).toMatch(/missing injected Catalog is not evidence/i);
});

test("issues one targeted semantic query and reads each Practice in full", async () => {
  const skill = await readSkill();

  expect(skill).toContain("lore query");
  expect(skill).toContain("targeted natural-language semantic query");
  expect(skill).toContain("lore get <practice-id>");
  expect(skill).toMatch(/do not act on a query summary alone/i);
  expect(skill).toContain("/skill:lorelum");
  expect(skill).toMatch(/extension never runs `lore query` or `lore get`/i);
});

test("routes preparation and error recovery through the trace reference", async () => {
  const skill = await readSkill();
  const reference = await readRecoveryReference();

  expect(skill).toContain("references/semantic-query-recovery.md");
  expect(skill).toContain("lore logs --trace-id");
  expect(reference).toContain('state: "preparing"');
  expect(reference).toMatch(/retry the same query/i);
  expect(reference).toContain("lore model status --json");
  expect(reference).toContain("lore index build --json");
  expect(reference).toMatch(/diagnostics\.traceId/);
});

test("keeps keyword lookup explicit and never an automatic fallback", async () => {
  const skill = await readSkill();
  const reference = await readRecoveryReference();

  expect(skill).toMatch(/Do not silently switch to keyword/i);
  expect(reference).toMatch(/Do not use keyword retrieval as an automatic fallback/i);
  expect(reference).toContain("--mode keyword");
});
