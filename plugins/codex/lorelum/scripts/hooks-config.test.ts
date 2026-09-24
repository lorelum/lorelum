import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("restores the Pack Catalog through SessionStart after compaction", async () => {
  const configuration = JSON.parse(
    await readFile(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
  ) as {
    readonly hooks: {
      readonly SessionStart?: readonly {
        readonly matcher: string;
        readonly hooks: readonly {
          readonly additionalContextLimit?: number;
          readonly command?: string;
          readonly commandWindows?: string;
        }[];
      }[];
      readonly PostCompact?: unknown;
    };
  };

  expect(configuration.hooks.SessionStart).toEqual([
    {
      matcher: "^(startup|resume|clear|compact)$",
      hooks: [expect.objectContaining({ additionalContextLimit: 5_000 })],
    },
  ]);
  expect(configuration.hooks.PostCompact).toBeUndefined();
  const hook = configuration.hooks.SessionStart?.[0]?.hooks[0];
  expect(hook?.command).toContain("lore hook codex");
  expect(hook?.commandWindows).toContain("lore hook codex");
  expect(hook?.command).not.toContain("bun");
  expect(hook?.commandWindows).not.toContain("bun");
});

test("routes only Bash tool hooks and shares bounded hints at SubagentStart", async () => {
  const configuration = JSON.parse(
    await readFile(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
  ) as {
    readonly hooks: Record<
      string,
      readonly {
        readonly matcher?: string;
        readonly hooks: readonly {
          readonly command: string;
          readonly commandWindows: string;
          readonly additionalContextLimit?: number;
        }[];
      }[]
    >;
  };
  for (const event of ["PreToolUse", "PostToolUse"]) {
    expect(configuration.hooks[event]?.[0]?.matcher).toBe("^Bash$");
    expect(configuration.hooks[event]?.[0]?.hooks[0]?.command).toContain("lore hook codex");
    expect(configuration.hooks[event]?.[0]?.hooks[0]?.commandWindows).toContain("lore hook codex");
  }
  expect(configuration.hooks.SubagentStart?.[0]?.hooks[0]?.additionalContextLimit).toBe(2000);
  expect(configuration.hooks.SubagentStart?.[0]?.hooks[0]?.command).toContain("lore hook codex");
});

test.skipIf(process.platform === "win32")(
  "new Hook commands allow an old CLI to fail open",
  async () => {
    const configuration = JSON.parse(
      await readFile(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
    ) as {
      readonly hooks: Record<
        string,
        readonly { readonly hooks: readonly { readonly command: string }[] }[]
      >;
    };
    const directory = await mkdtemp(join(tmpdir(), "lorelum-old-cli-"));
    const lore = join(directory, "lore");
    await writeFile(lore, "#!/bin/sh\nexit 2\n", "utf8");
    await chmod(lore, 0o755);
    try {
      for (const event of ["PreToolUse", "PostToolUse", "SubagentStart"]) {
        const command = configuration.hooks[event]?.[0]?.hooks[0]?.command;
        if (!command) throw new Error(`Missing ${event} command.`);
        const child = Bun.spawn(["sh", "-c", command], {
          env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
        child.stdin.write(JSON.stringify({ hook_event_name: event, tool_name: "Bash" }));
        child.stdin.end();
        expect(await child.exited).toBe(0);
        expect(await new Response(child.stdout).text()).toBe("{}\n");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "old CLI success envelope is not forwarded as PreToolUse control",
  async () => {
    const configuration = JSON.parse(
      await readFile(join(import.meta.dir, "../hooks/hooks.json"), "utf8"),
    ) as {
      readonly hooks: Record<
        string,
        readonly { readonly hooks: readonly { readonly command: string }[] }[]
      >;
    };
    const directory = await mkdtemp(join(tmpdir(), "lorelum-old-cli-"));
    const lore = join(directory, "lore");
    await writeFile(lore, "#!/bin/sh\nprintf '{\"continue\":true}\\n'\n", "utf8");
    await chmod(lore, 0o755);
    try {
      for (const event of ["PreToolUse", "PostToolUse"]) {
        const child = Bun.spawn(["sh", "-c", configuration.hooks[event]![0]!.hooks[0]!.command], {
          env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(await child.exited).toBe(0);
        expect(await new Response(child.stdout).text()).toBe("{}\n");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "forwards the Hook payload to lore hook codex without a Bun runtime",
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
    if (command === undefined) throw new Error("Missing Codex Hook command.");

    const directory = await mkdtemp(join(tmpdir(), "lorelum-hook-cli-"));
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
    if (command === undefined) throw new Error("Missing Codex Hook command.");

    const directory = await mkdtemp(join(tmpdir(), "lorelum-old-cli-"));
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
