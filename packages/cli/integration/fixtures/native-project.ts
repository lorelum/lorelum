import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeNativeProjectPack(root: string, count: number): Promise<void> {
  const pack = join(root, ".lorelum", "packs", "performance");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: performance\nversion: 1.0.0\n");
  await Promise.all(Array.from({ length: count }, (_, index) => writeNativePractice(root, index)));
}

export async function writeNativeChildOverlay(root: string): Promise<void> {
  const pack = join(root, ".lorelum", "packs", "performance");
  await mkdir(join(pack, "practices"), { recursive: true });
  await writeFile(join(pack, "pack.yaml"), "name: performance\nversion: 1.0.0\n");
  await writeFile(
    join(pack, "practices", "performance.practice.000.md"),
    practice("performance.practice.000", "Child winner", "child winner marker"),
  );
  await writeFile(join(pack, "practices", "invalid.md"), "---\nid: [\n---\ninvalid\n");
}

export async function writeNativePractice(
  root: string,
  index: number,
  marker?: string,
): Promise<void> {
  const suffix = String(index).padStart(3, "0");
  await writeFile(
    join(
      root,
      ".lorelum",
      "packs",
      "performance",
      "practices",
      `performance.practice.${suffix}.md`,
    ),
    practice(
      `performance.practice.${suffix}`,
      `Performance Practice ${suffix}`,
      marker ?? `marker-v1-${suffix}`,
    ),
  );
}

function practice(id: string, title: string, marker: string): string {
  return `---
id: ${id}
title: ${title}
stage: implementation
tech_stack:
  - typescript
applies_when: When verifying native ProjectContext semantic retrieval.
---
${Array.from(
  { length: 12 },
  (_, index) =>
    `Practice ${id} documents ${marker} for native semantic retrieval batch ${index + 1}.`,
).join("\n")}
`;
}
