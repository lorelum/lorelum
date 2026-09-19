import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { InstalledPacksFixture } from "../fixtures/installed-packs.js";
import { runProcess } from "../support/process.js";
import { isRecord, parseSingleResponse } from "../support/protocol.js";

/** Verify the raw WorkBuddy Hook ABI through the compiled CLI. */
export async function verifyWorkbuddyHookScenario(
  compiledBinary: string,
  fixture: InstalledPacksFixture,
  workingDirectory: string,
): Promise<void> {
  const successful = await runWorkbuddyHook(compiledBinary, fixture.storageRoot, {
    hook_event_name: "SessionStart",
  });
  assert.equal(successful.exitCode, 0);
  assert.equal(successful.stderr, "");
  const response = parseSingleResponse(successful.stdout);
  assert(isRecord(response.hookSpecificOutput));
  assert.equal(response.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(String(response.hookSpecificOutput.additionalContext), /integration-pack/);
  assert.match(
    String(response.hookSpecificOutput.additionalContext),
    /Process integration fixture/,
  );
  assert.equal("protocolVersion" in response, false);
  assert.equal("command" in response, false);

  const malformed = await runWorkbuddyHook(compiledBinary, fixture.storageRoot, "{");
  assert.equal(malformed.exitCode, 0);
  assert.equal(malformed.stdout, '{"continue":true}\n');
  assert.match(malformed.stderr, /^lore hook workbuddy degraded: /);

  const unsupported = await runWorkbuddyHook(compiledBinary, fixture.storageRoot, {
    hook_event_name: "PostCompact",
  });
  assert.equal(unsupported.exitCode, 0);
  assert.equal(unsupported.stdout, '{"continue":true}\n');
  assert.match(unsupported.stderr, /unsupported event/);

  const unavailableStore = join(workingDirectory, "unavailable-workbuddy-hook-store");
  await writeFile(unavailableStore, "not a directory\n");
  const unavailable = await runWorkbuddyHook(compiledBinary, unavailableStore, {
    hook_event_name: "SessionStart",
  });
  assert.equal(unavailable.exitCode, 0);
  assert.equal(unavailable.stdout, '{"continue":true}\n');
  assert.match(unavailable.stderr, /^lore hook workbuddy degraded: /);
}

function runWorkbuddyHook(
  binaryPath: string,
  storageRoot: string,
  payload: Record<string, unknown> | string,
) {
  return runProcess(
    [binaryPath, "hook", "workbuddy", "--store-root", storageRoot],
    60_000,
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );
}
