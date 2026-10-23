/** Test-only process entrypoint: the real CLI and detached worker against a local release server. */
import { run } from "../../src/main.js";
import { createAutoUpdateService, runAutoUpdateWorker } from "../../src/update/auto-check.js";
import { listReleases } from "../../src/update/release-client.js";

const args = process.argv.slice(2);
if (
  !(await runAutoUpdateWorker(args, {
    list: (channel, target, signal) =>
      listReleases(channel, target, fetch, process.env.LORELUM_TEST_RELEASE_URL!, { signal }),
  }))
) {
  process.exitCode = await run(args, {
    autoUpdate: createAutoUpdateService({ currentVersion: process.env.LORELUM_TEST_VERSION! }),
  });
}
