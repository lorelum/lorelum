import type { GuidanceProfile } from "./profiles.ts";

export interface GuidanceSources {
  readonly skillTemplate: string;
  readonly recovery: string;
}

export interface RenderedGuidance {
  readonly skill: string;
  readonly recovery: string;
}

const skillMarker =
  "<!-- Generated from scripts/skill-guidance/content/skill.md.tmpl and profiles.ts. Run bun run skills:generate to regenerate. -->";
const recoveryMarker =
  "<!-- Generated from scripts/skill-guidance/content/recovery.md. Run bun run skills:generate to regenerate. -->";

const slots = ["description", "catalog", "readHints"] as const;

export function renderGuidance(
  sources: GuidanceSources,
  profile: GuidanceProfile,
): RenderedGuidance {
  const skillBody = renderSkillTemplate(sources.skillTemplate, profile);
  const frontMatter = /^---\n[\s\S]*?\n---\n/.exec(skillBody);
  if (!frontMatter) {
    throw new Error("The rendered Skill must start with YAML frontmatter.");
  }

  const skill = normalizeOutput(
    `${frontMatter[0]}${skillMarker}\n${skillBody.slice(frontMatter[0].length)}`,
  );
  const recovery = normalizeOutput(`${recoveryMarker}\n${sources.recovery}`);
  return { skill, recovery };
}

function renderSkillTemplate(template: string, profile: GuidanceProfile): string {
  let rendered = template.replace(/\r\n?/g, "\n");
  const values: Readonly<Record<(typeof slots)[number], string>> = {
    description: profile.description,
    catalog: profile.catalog,
    readHints: profile.readHints,
  };

  for (const slot of slots) {
    const token = `{{${slot}}}`;
    const occurrences = rendered.split(token).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `The Skill template must contain exactly one ${token} slot; found ${occurrences}.`,
      );
    }
    rendered = rendered.replace(token, values[slot]);
  }

  const unknownSlot = /\{\{[^{}]+\}\}/.exec(rendered);
  if (unknownSlot) {
    throw new Error(`The Skill template contains an unknown slot: ${unknownSlot[0]}.`);
  }

  return normalizeOutput(rendered);
}

function normalizeOutput(content: string): string {
  const normalized = content
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return `${normalized}\n`;
}
