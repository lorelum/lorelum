/* eslint-disable no-await-in-loop -- Each scenario intentionally observes successive CLI calls. */
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileCli } from "../../../scripts/release/compile-cli.js";
import { releaseTarget } from "../src/update/version-catalog.js";

const directory = await mkdtemp(join(tmpdir(), "lorelum-auto-process-"));
let latest = "0.1.1";
let responseCompleted = false;
let requests = 0;
const server = Bun.serve({
  port: 0,
  async fetch() {
    requests++;
    await Bun.sleep(2_000);
    responseCompleted = true;
    return Response.json([
      {
        tag_name: `v${latest}`,
        draft: false,
        prerelease: false,
        html_url: `https://github.com/lorelum/lorelum/releases/tag/v${latest}`,
        assets: [{ name: `lore-${latest}-${releaseTarget()}.tar.gz` }, { name: "SHA256SUMS" }],
      },
    ]);
  },
});

try {
  const entrypoint = join(import.meta.dir, "fixtures/auto-update-entry.ts");
  const source = [process.execPath, entrypoint];
  const compiled = await compileCli({
    outfile: join(directory, "lore-fixture"),
    entrypoint,
  });
  for (const [kind, command] of [
    ["source", source],
    ["compiled", [compiled.output]],
  ] as const) {
    const home = join(directory, kind);
    const root = join(home, ".lorelum");
    const store = join(directory, `${kind}-store`);
    const invoke = async (version = "0.1.0", json = false) => {
      const started = performance.now();
      const child = Bun.spawn(
        [...command, "pack", "list", "--store-root", store, ...(json ? ["--json"] : [])],
        {
          env: {
            ...process.env,
            HOME: home,
            LORELUM_HOST_KEY: "codex",
            LORELUM_HOST_SESSION_ID: "same-conversation",
            LORELUM_TEST_RELEASE_URL: server.url.href,
            LORELUM_TEST_VERSION: version,
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      assert.equal(code, 0, stderr);
      assert.equal(stderr, "");
      return { stdout, ms: performance.now() - started };
    };
    const databasePath = join(root, "updates.sqlite");
    const waitReady = async (version: string) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const database = new Database(databasePath, { readonly: true });
        // This observer may wait for the worker's short commit; production callers never do.
        database.exec("PRAGMA busy_timeout = 1000");
        const row = database
          .query("SELECT candidate_version FROM checks WHERE current_version = ?")
          .get(version) as { candidate_version: string | null } | null;
        database.close();
        if (row?.candidate_version === latest) return;
        await Bun.sleep(25);
      }
      throw new Error(`${kind}: detached worker did not publish its result`);
    };
    latest = "0.1.1";
    responseCompleted = false;
    const cold = await invoke();
    assert.equal(responseCompleted, false, "parent waited for slow release response");
    assert(!cold.stdout.includes("update available"));
    await waitReady("0.1.0");
    const json = await invoke("0.1.0", true);
    assert.equal(JSON.parse(json.stdout).ok, true);
    assert(!json.stdout.includes("update available"));
    const ready = await invoke();
    assert(ready.stdout.includes("0.1.1"));
    assert(ready.stdout.includes("Lorelum update available"));
    const hot = await invoke();
    assert(!hot.stdout.includes("update available"));

    // Expire only the fixture's check, then discover a newer target in the same session.
    latest = "0.1.2";
    const database = new Database(databasePath);
    database.exec("UPDATE checks SET checked_at = 0, next_check_at = 0");
    database.close();
    await invoke();
    await waitReady("0.1.0");
    const concurrent = await Promise.all([invoke(), invoke(), invoke(), invoke()]);
    assert.equal(
      concurrent.filter((result) => result.stdout.includes("update available")).length,
      1,
    );
    await invoke("0.1.1");
    await waitReady("0.1.1");
    assert((await invoke("0.1.1")).stdout.includes("0.1.2"));
    assert(!(await invoke("0.1.0")).stdout.includes("update available"));
    console.log(
      `${kind}: cold=${cold.ms.toFixed(0)}ms hot=${hot.ms.toFixed(0)}ms; detached result, JSON preservation, pair dedup, concurrent claim, new target and version reset passed`,
    );
  }
  assert.equal(requests, 6, "one worker per current-version partition and expired check");
} finally {
  server.stop(true);
  await rm(directory, { recursive: true, force: true });
}
