import { expect, test } from "bun:test";
import assert from "node:assert/strict";

import { ProcessTimeoutError, runProcess } from "./process.js";

// process.execPath is the real bun binary; Bun.which may resolve to an
// npm-generated .cmd shim that cannot carry cmd metacharacters in arguments.
const bunExecutable = process.execPath;

test("collects a completed process result", async () => {
  await expect(runProcess([bunExecutable, "-e", "console.log('ok')"])).resolves.toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "ok\n",
  });
});

test("forwards optional standard input before collecting process output", async () => {
  await expect(
    runProcess(
      [bunExecutable, "-e", "process.stdout.write(await Bun.stdin.text())"],
      60_000,
      "hook payload",
    ),
  ).resolves.toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "hook payload",
  });
});

test("merges environment overrides while keeping parent variables", async () => {
  const probe = `
const home = process.env.LORELUM_INTEGRATION_HOME ?? "missing";
const path = typeof process.env.PATH === "string" ? "path-present" : "path-missing";
console.log(home + "," + path);
`;
  await expect(
    runProcess([bunExecutable, "-e", probe], 60_000, undefined, {
      LORELUM_INTEGRATION_HOME: "isolated-home",
    }),
  ).resolves.toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "isolated-home,path-present\n",
  });
});

test("terminates a timed-out process before rejecting", async () => {
  try {
    await runProcess(
      [bunExecutable, "-e", "console.log('started'); setInterval(() => undefined, 1_000);"],
      100,
    );
    assert.fail("expected the child process to time out");
  } catch (error) {
    assert(error instanceof ProcessTimeoutError);
    assert.match(error.message, /stdout:\nstarted\n/);
  }
});
