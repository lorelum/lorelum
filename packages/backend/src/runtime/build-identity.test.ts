import { expect, test } from "bun:test";
import { isCompiledEntrypoint } from "./build-identity";

test("compiled entrypoint detection covers both Bun roots and Windows separators", () => {
  for (const path of [
    "/$bunfs/root/lore",
    "B:/~BUN/root/lore",
    "B:\\~BUN\\root\\lore",
    "C:\\$bunfs\\root\\lore",
  ])
    expect(isCompiledEntrypoint(path)).toBe(true);
  for (const path of [
    "/project/packages/cli/src/main.ts",
    "C:\\project\\main.ts",
    "/project/~BUN/main.ts",
  ])
    expect(isCompiledEntrypoint(path)).toBe(false);
});
