import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBundledPackageNotices, renderThirdPartyNotices } from "./notices";

test("collects only nearest bundled package manifests and renders stable notices", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-release-notices-"));
  try {
    const packageDirectory = join(directory, "node_modules", "example-package");
    await mkdir(join(packageDirectory, "dist"), { recursive: true });
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: "example-package", version: "1.2.3", license: "MIT" }),
    );
    await writeFile(join(packageDirectory, "dist", "index.js"), "export {};\n");
    await mkdir(join(packageDirectory, "dist", "generated"));
    await writeFile(join(packageDirectory, "dist", "generated", "package.json"), "{}");

    await expect(
      collectBundledPackageNotices([
        join(packageDirectory, "dist", "index.js"),
        join(packageDirectory, "dist", "generated", "package.json"),
        join(directory, "packages", "cli", "src", "main.ts"),
      ]),
    ).resolves.toEqual([{ name: "example-package", version: "1.2.3", license: "MIT" }]);
    expect(
      renderThirdPartyNotices("1.4.2", [
        { name: "zod", version: "4.4.3", license: "MIT" },
        { name: "commander", version: "15.0.0", license: "MIT" },
      ]),
    ).toBe(
      "Lorelum CLI third-party notices\n\nBun runtime 1.4.2 — MIT\nzod@4.4.3 — MIT\ncommander@15.0.0 — MIT\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
