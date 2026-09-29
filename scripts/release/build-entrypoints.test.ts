import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type PackageManifest = {
  readonly scripts: Readonly<Record<string, string>>;
};

const repositoryRoot = resolve(import.meta.dir, "../..");
const manifest = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
) as PackageManifest;

test("CLI build scripts expose the full bundle as authoritative and binary-only explicitly", () => {
  expect(manifest.scripts["build:cli"]).toBe("bun scripts/release/build.ts");
  expect(manifest.scripts["build:cli-only"]).toBe("bun scripts/release/build-cli.ts");
  expect(manifest.scripts["build:release-staging"]).toBe("bun scripts/release/build.ts");
  expect(manifest.scripts["build:semantic-cli"]).toBeUndefined();
});
