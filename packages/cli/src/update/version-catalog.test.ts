import { expect, test } from "bun:test";
import {
  defaultChannel,
  normalizeVersion,
  releaseTarget,
  selectUpdate,
} from "./version-catalog.js";

test("SemVer precedence, channel and supported targets", () => {
  expect(defaultChannel("0.1.0-alpha.4+build")).toBe("prerelease");
  expect(defaultChannel("0.1.0+build")).toBe("stable");
  expect(normalizeVersion("v0.1.0-alpha.4")).toBe("0.1.0-alpha.4");
  expect(normalizeVersion("not-a-version")).toBeUndefined();
  expect(normalizeVersion("1.2.3-..")).toBeUndefined();
  expect(normalizeVersion("1.2.3-01")).toBeUndefined();
  expect(releaseTarget("darwin", "arm64")).toBe("darwin-arm64");
  expect(releaseTarget("linux", "x64")).toBe("linux-x64");
  expect(releaseTarget("win32", "x64")).toBe("win32-x64");
  expect(releaseTarget("linux", "arm64")).toBeUndefined();
  const releases = [
    { version: "0.1.0-alpha.4", notesUrl: "alpha.4" },
    { version: "0.1.0-alpha.3", notesUrl: "alpha.3" },
  ];
  expect(selectUpdate("0.1.0-alpha.3", "prerelease", releases, true)).toMatchObject({
    latestVersion: "0.1.0-alpha.4",
    status: "available",
    canApply: true,
  });
  expect(selectUpdate("0.1.0-alpha.4+local", "prerelease", releases, false).status).toBe("current");
  expect(selectUpdate("0.1.0-alpha.5", "prerelease", releases, false).status).toBe("ahead");
  expect(selectUpdate("0.1.0-alpha.4", "stable", [], false)).toMatchObject({
    latestVersion: null,
    status: "no-release",
    releaseNotesUrl: null,
  });
});
