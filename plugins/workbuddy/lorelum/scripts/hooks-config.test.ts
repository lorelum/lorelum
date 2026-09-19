import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("restores the Pack Catalog through SessionStart after compaction", async () => {
  const configuration = JSON.parse(
    await readFile(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
  ) as {
    readonly description?: unknown;
    readonly hooks: {
      readonly SessionStart?: readonly {
        readonly matcher: string;
        readonly hooks: readonly {
          readonly additionalContextLimit?: number;
          readonly command?: string;
          readonly commandWindows?: string;
          readonly timeout?: number;
          readonly type?: string;
        }[];
      }[];
      readonly PostCompact?: unknown;
    };
  };

  expect(configuration.hooks.SessionStart).toEqual([
    {
      // WorkBuddy matches SessionStart sources by exact token after splitting
      // the matcher on "|". Anchored regex forms ("^(startup|...)$") never
      // match on the live host, so the matcher stays unanchored (zCode style).
      matcher: "startup|resume|clear|compact",
      hooks: [expect.objectContaining({ additionalContextLimit: 5_000, timeout: 10, type: "command" })],
    },
  ]);
  expect(configuration.hooks.PostCompact).toBeUndefined();
  const hook = configuration.hooks.SessionStart?.[0]?.hooks[0];
  expect(hook?.command).toContain("lore hook workbuddy");
  expect(hook?.commandWindows).toContain("lore hook workbuddy");
  expect(hook?.command).toContain('{"continue":true}');
  expect(hook?.command).not.toContain("bun");
  expect(hook?.commandWindows).not.toContain("bun");
});

test.skipIf(process.platform === "win32")(
  "forwards the Hook payload to lore hook workbuddy without a Bun runtime",
  async () => {
    const configuration = JSON.parse(
      await readFile(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
    ) as {
      readonly hooks: {
        readonly SessionStart?: readonly {
          readonly hooks: readonly { readonly command?: string }[];
        }[];
      };
    };
    const command = configuration.hooks.SessionStart?.[0]?.hooks[0]?.command;
    if (command === undefined) throw new Error("Missing WorkBuddy Hook command.");

    const directory = await mkdtemp(join(tmpdir(), "lorelum-workbuddy-hook-cli-"));
    const lore = join(directory, "lore");
    const payload = '{"hook_event_name":"SessionStart"}';
    await writeFile(
      lore,
      [
        "#!/bin/sh",
        'input="$(cat)"',
        `if [ "$input" != '${payload}' ]; then exit 2; fi`,
        'printf \'{"hookSpecificOutput":{"hookEventName":"SessionStart"}}\\n\'',
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(lore, 0o755);

    try {
      const child = Bun.spawn(["sh", "-c", command], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      child.stdin.write(payload);
      child.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toBe('{"hookSpecificOutput":{"hookEventName":"SessionStart"}}\n');
      expect(stderr).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "uses a single continue envelope when an older CLI rejects the Hook ABI",
  async () => {
    const configuration = JSON.parse(
      await readFile(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
    ) as {
      readonly hooks: {
        readonly SessionStart?: readonly {
          readonly hooks: readonly { readonly command?: string }[];
        }[];
      };
    };
    const command = configuration.hooks.SessionStart?.[0]?.hooks[0]?.command;
    if (command === undefined) throw new Error("Missing WorkBuddy Hook command.");

    const directory = await mkdtemp(join(tmpdir(), "lorelum-workbuddy-old-cli-"));
    const oldLore = join(directory, "lore");
    await writeFile(oldLore, "#!/bin/sh\nprintf '{\"ok\":false}\\n'\nexit 2\n", "utf8");
    await chmod(oldLore, 0o755);

    try {
      const child = Bun.spawn(["sh", "-c", command], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toBe('{"continue":true}\n');
      expect(stderr).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
