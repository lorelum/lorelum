import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run as runCli } from "../main";
import { createIsolatedProjectSandbox } from "./project-sandbox.test-helper";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("context status reports safe ProjectContext provenance without absolute source paths", async () => {
  const [root, store] = await Promise.all([
    createIsolatedProjectSandbox("lorelum-context-status-"),
    mkdtemp(join(tmpdir(), "lorelum-context-status-store-")),
  ]);
  try {
    const pack = join(root, ".lorelum", "packs", "platform");
    await mkdir(join(pack, "practices"), { recursive: true });
    await writeFile(join(root, ".lorelum", "config.yaml"), "base: none\n");
    await writeFile(join(pack, "pack.yaml"), "name: platform\nversion: 1.0.0\n");
    await writeFile(
      join(pack, "practices", "query.md"),
      "---\nid: platform.query\ntitle: Status\nstage: implementation\ntech_stack: [typescript]\napplies_when: When reading a safe context status.\n---\nReturn only safe provenance.\n",
    );
    const output = new MemoryWriter();
    expect(
      await run(["context", "status", "--project-root", root, "--store-root", store], {
        stdout: output,
      }),
    ).toBe(0);
    const response = JSON.parse(output.value);
    expect(response).toMatchObject({
      command: "context.status",
      ok: true,
      data: {
        state: "ready",
        base: "none",
        practiceCount: 1,
        sources: [
          {
            scope: "project",
            status: "active",
            packName: "platform",
            practiceId: "platform.query",
          },
        ],
      },
    });
    expect(output.value).not.toContain(root);
    expect(output.value).not.toContain(store);
    expect(output.value).not.toContain("Return only safe provenance.");
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(store, { recursive: true, force: true }),
    ]);
  }
});
