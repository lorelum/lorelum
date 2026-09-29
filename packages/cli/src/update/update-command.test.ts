import { expect, test } from "bun:test";
import type { CommandInvocation } from "../registry.js";
import { createCliUpdateCommand, type UpdateServices } from "./update-command.js";
import { toolVersion } from "../output/protocol.js";
import { InstallerFailure } from "./managed-install.js";

const managed = {
  entry: "/home/test/.local/bin/lore",
  executable: "/home/test/.local/share/lorelum/versions/old/lore",
  installer: "/home/test/.local/share/lorelum/versions/old/install.sh",
};
const nextVersion = `${Number(toolVersion.split(".")[0]) + 1}.0.0`;
const notesUrl = `https://github.com/lorelum/lorelum/releases/tag/v${nextVersion}`;
const newer = [{ version: nextVersion, notesUrl }];
const invocation = (apply: boolean, channel?: string) =>
  ({
    options: { apply, ...(channel ? { channel } : {}) },
    positionals: [],
    describeCommand: () => undefined,
    traceId: "00000000-0000-4000-8000-000000000001",
  }) as unknown as CommandInvocation;

test("no candidate and same version never start an installer", async () => {
  let starts = 0;
  const services: UpdateServices = {
    target: () => "darwin-arm64",
    findInstall: async () => managed,
    list: async () => [{ version: toolVersion, notesUrl }],
    install: async () => {
      starts++;
      return true;
    },
  };
  expect((await createCliUpdateCommand(services).handler(invocation(true))).data).toMatchObject({
    status: "current",
  });
  expect(
    (
      await createCliUpdateCommand({ ...services, list: async () => [] }).handler(
        invocation(true, "stable"),
      )
    ).data,
  ).toMatchObject({ status: "no-release", latestVersion: null });
  expect(starts).toBe(0);
});

test("an incomplete check or failed proxy does not return a stale result or leak credentials", async () => {
  for (const error of ["proxy username:password", "page 2 failed"]) {
    const command = createCliUpdateCommand({
      target: () => "darwin-arm64",
      findInstall: async () => managed,
      list: async () => {
        throw new Error(error);
      },
    });
    expect(command.handler(invocation(false))).rejects.toMatchObject({
      code: "update.unavailable",
      message: expect.not.stringContaining("password"),
    });
  }
});

test("refuses changed entry, missing installer and failed installation before claiming success", async () => {
  let checks = 0;
  let starts = 0;
  const common: UpdateServices = {
    target: () => "darwin-arm64",
    list: async () => newer,
    findInstall: async () => (++checks === 1 ? managed : undefined),
    install: async () => {
      starts++;
      return true;
    },
  };
  expect(createCliUpdateCommand(common).handler(invocation(true))).rejects.toMatchObject({
    code: "update.apply-unsupported",
  });
  expect(starts).toBe(0);
  expect(
    createCliUpdateCommand({
      ...common,
      findInstall: async () => managed,
      available: async () => false,
    }).handler(invocation(true)),
  ).rejects.toMatchObject({ code: "update.apply-unsupported" });
  expect(starts).toBe(0);
  expect(
    createCliUpdateCommand({
      ...common,
      findInstall: async () => managed,
      available: async () => true,
      install: async () => false,
    }).handler(invocation(true)),
  ).rejects.toMatchObject({ code: "update.apply-failed" });
});

test("post-switch version mismatch is an explicit failure", async () => {
  const command = createCliUpdateCommand({
    target: () => "darwin-arm64",
    findInstall: async () => managed,
    available: async () => true,
    list: async () => newer,
    install: async () => true,
    entryVersion: async () => toolVersion,
    progress: { write() {} },
  });
  expect(command.handler(invocation(true))).rejects.toMatchObject({
    code: "update.verification-failed",
  });
});

test("installer Backend failure gives a safe actionable reason", async () => {
  const command = createCliUpdateCommand({
    target: () => "darwin-arm64",
    findInstall: async () => managed,
    available: async () => true,
    list: async () => newer,
    install: async () => {
      throw new InstallerFailure("backend");
    },
    progress: { write() {} },
  });
  expect(command.handler(invocation(true))).rejects.toMatchObject({
    code: "update.apply-failed",
    message: expect.stringContaining("could not safely stop the Backend"),
  });
});
