/* eslint-disable no-await-in-loop -- Each malformed configuration is an independent fixture. */
import { expect, test } from "bun:test";
import type { ConfigDocument } from "@lorelum/config";
import { loadAutoUpdateSetting } from "./update-settings.js";

test("automatic update checks default on and honor the explicit boolean setting", async () => {
  const read = (document: ConfigDocument) => async () => document;
  await expect(loadAutoUpdateSetting(read({}))).resolves.toBe(true);
  await expect(loadAutoUpdateSetting(read({ updates: {} }))).resolves.toBe(true);
  await expect(loadAutoUpdateSetting(read({ updates: { autoCheck: true } }))).resolves.toBe(true);
  await expect(loadAutoUpdateSetting(read({ updates: { autoCheck: false } }))).resolves.toBe(false);
});

test("malformed update settings and config read failures quietly disable the sidecar", async () => {
  for (const document of [
    { updates: null },
    { updates: [] },
    { updates: "disabled" },
    { updates: { autoCheck: "false" } },
  ] satisfies ConfigDocument[]) {
    await expect(loadAutoUpdateSetting(async () => document)).resolves.toBe(false);
  }
  await expect(
    loadAutoUpdateSetting(async () => {
      throw new Error("private config parse detail");
    }),
  ).resolves.toBe(false);
});
