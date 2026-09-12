import { expect, test } from "bun:test";
import { win32 } from "node:path";
import {
  nativeBuildCacheEntryDirectory,
  nativeBuildCacheKey,
  nativeBuildCacheRoot,
} from "./cache-paths";

test("native developer cache uses platform cache conventions instead of repository or config paths", () => {
  expect(nativeBuildCacheRoot({ platform: "darwin", homeDirectory: "/home/dev" })).toBe(
    "/home/dev/Library/Caches/Lorelum/native/v1",
  );
  expect(
    nativeBuildCacheRoot({
      platform: "linux",
      homeDirectory: "/home/dev",
      environment: { XDG_CACHE_HOME: "/var/cache/dev" },
    }),
  ).toBe("/var/cache/dev/lorelum/native/v1");
  expect(
    nativeBuildCacheRoot({
      platform: "linux",
      homeDirectory: "/home/dev",
      environment: { XDG_CACHE_HOME: "relative" },
    }),
  ).toBe("/home/dev/.cache/lorelum/native/v1");
  expect(
    nativeBuildCacheRoot({
      platform: "win32",
      homeDirectory: "C:\\Users\\dev",
      environment: { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" },
    }),
  ).toBe(win32.join("C:\\Users\\dev\\AppData\\Local", "Lorelum", "Cache", "native", "v1"));
});

test("native cache key changes with recipe and toolchain inputs but never worktree paths", () => {
  const input = {
    target: "darwin-arm64",
    recipeIdentity: "a".repeat(64),
    cmakeVersion: "3.31.6",
    cmakeArchiveSha256: "b".repeat(64),
    compiler: "Apple clang 17",
    sdkVersion: "15.0",
  };
  const first = nativeBuildCacheKey(input);
  expect(first).toHaveLength(64);
  expect(nativeBuildCacheKey({ ...input })).toBe(first);
  expect(nativeBuildCacheKey({ ...input, compiler: "Apple clang 18" })).not.toBe(first);
  expect(nativeBuildCacheEntryDirectory("/cache", input.target, first)).toBe(
    `/cache/darwin-arm64/${first}`,
  );
});
