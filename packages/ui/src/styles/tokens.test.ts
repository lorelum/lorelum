import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
const designMd = readFileSync(new URL("../../../../DESIGN.md", import.meta.url), "utf8");

const requiredSemanticRoles = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "primary-hover",
  "primary-pressed",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "destructive-hover",
  "destructive-pressed",
  "border",
  "border-strong",
  "input",
  "ring",
  "surface",
  "surface-foreground",
  "surface-raised",
  "surface-sunken",
  "overlay",
  "selection",
  "selection-foreground",
  "success",
  "success-foreground",
  "success-subtle",
  "warning",
  "warning-foreground",
  "warning-subtle",
  "info",
  "info-foreground",
  "info-subtle",
  "code",
  "code-foreground",
  "code-comment",
  "code-keyword",
  "code-string",
  "code-number",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

function declarations(selector: ".lorelum-ui" | ".dark .lorelum-ui") {
  const escapedSelector = selector.replaceAll(".", "\\.");
  const block = tokensCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!block) throw new Error(`Missing ${selector} token block`);

  return new Map(
    Array.from(block.matchAll(/--([\w-]+):\s*([^;]+);/g), (match) => [match[1]!, match[2]!.trim()]),
  );
}

function designColor(name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = designMd.match(new RegExp(`^  ${escapedName}: "(#[0-9A-Fa-f]{6})"$`, "m"))?.[1];
  if (!value) throw new Error(`Missing DESIGN.md color token: ${name}`);
  return value.toLowerCase();
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe("design tokens", () => {
  test("keeps required semantic roles inside an explicit consumer scope", () => {
    expect(tokensCss).not.toMatch(/:root\s*\{/);

    const light = declarations(".lorelum-ui");
    const dark = declarations(".dark .lorelum-ui");

    for (const role of requiredSemanticRoles) {
      expect(light.has(role), `light theme is missing --${role}`).toBe(true);
      expect(dark.has(role), `dark theme is missing --${role}`).toBe(true);
    }
  });

  test("keeps action foreground pairs at WCAG AA contrast", () => {
    for (const theme of [declarations(".lorelum-ui"), declarations(".dark .lorelum-ui")]) {
      for (const role of ["primary", "destructive", "success", "warning", "info"] as const) {
        const background = theme.get(role);
        const foreground = theme.get(`${role}-foreground`);
        expect(background).toMatch(/^#[0-9a-f]{6}$/i);
        expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrastRatio(foreground!, background!), `${role} contrast`).toBeGreaterThanOrEqual(
          4.5,
        );
      }

      for (const [backgroundRole, foregroundRole] of [
        ["primary-hover", "primary-foreground"],
        ["primary-pressed", "primary-foreground"],
        ["destructive-hover", "destructive-foreground"],
        ["destructive-pressed", "destructive-foreground"],
      ] as const) {
        expect(
          contrastRatio(theme.get(foregroundRole)!, theme.get(backgroundRole)!),
          `${backgroundRole} contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("keeps readable semantic text pairs at WCAG AA contrast", () => {
    for (const theme of [declarations(".lorelum-ui"), declarations(".dark .lorelum-ui")]) {
      for (const [backgroundRole, foregroundRole] of [
        ["background", "foreground"],
        ["card", "card-foreground"],
        ["popover", "popover-foreground"],
        ["secondary", "secondary-foreground"],
        ["muted", "muted-foreground"],
        ["accent", "accent-foreground"],
        ["surface", "surface-foreground"],
        ["selection", "selection-foreground"],
        ["code", "code-foreground"],
        ["sidebar", "sidebar-foreground"],
        ["sidebar-primary", "sidebar-primary-foreground"],
        ["sidebar-accent", "sidebar-accent-foreground"],
      ] as const) {
        expect(
          contrastRatio(theme.get(foregroundRole)!, theme.get(backgroundRole)!),
          `${foregroundRole} on ${backgroundRole}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("maps semantic roles to Tailwind without duplicating palette values", () => {
    expect(themeCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);

    for (const role of requiredSemanticRoles) {
      expect(themeCss).toContain(`--color-${role}: var(--${role});`);
    }
  });

  test("keeps the primary action contract aligned with DESIGN.md", () => {
    const light = declarations(".lorelum-ui");
    const dark = declarations(".dark .lorelum-ui");

    expect(light.get("primary")?.toLowerCase()).toBe(designColor("light-primary"));
    expect(light.get("primary-foreground")?.toLowerCase()).toBe(
      designColor("light-primary-foreground"),
    );
    expect(dark.get("primary")?.toLowerCase()).toBe(designColor("primary"));
    expect(dark.get("primary-foreground")?.toLowerCase()).toBe(
      designColor("dark-primary-foreground"),
    );
  });

  test("defines each foundation needed by reusable components", () => {
    for (const prefix of [
      "--lore-font-",
      "--lore-text-",
      "--lore-leading-",
      "--lore-space-",
      "--lore-radius-",
      "--lore-blur-",
      "--lore-shadow-",
      "--lore-motion-",
      "--lore-ease-",
      "--lore-size-",
      "--lore-layer-",
    ]) {
      expect(tokensCss).toContain(prefix);
    }
  });
});
