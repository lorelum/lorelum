import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";

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

test("runs with an explicitly isolated environment and working directory", async () => {
  const cwd = realpathSync(tmpdir());
  const result = await runProcess(
    [
      bunExecutable,
      "-e",
      "console.log(JSON.stringify([process.env.LORELUM_TEST_PROCESS, process.cwd()]))",
    ],
    60_000,
    undefined,
    { environment: { ...process.env, LORELUM_TEST_PROCESS: "isolated" }, cwd },
  );
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(["isolated", cwd]);
  expect(result.stderr).toBe("");
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
