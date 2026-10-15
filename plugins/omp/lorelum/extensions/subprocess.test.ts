import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { createBridgeExecutor, type BridgeRequest } from "./subprocess";

function fakeChild(pid = 123) {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let input = "";
  stdin.on("data", (chunk) => {
    input += chunk.toString();
  });
  const kill = mock(() => true);
  const unref = mock(() => {});
  const child = Object.assign(emitter, {
    pid,
    stdin,
    stdout,
    stderr,
    kill,
    unref,
  }) as unknown as ChildProcessWithoutNullStreams;
  return { child, stdin, stdout, stderr, kill, unref, input: () => input };
}

describe("Lorelum bridge subprocess boundary", () => {
  test("uses Unix argv without shell or environment overrides and writes the JSON request", async () => {
    const fake = fakeChild();
    const launch = mock(
      (_command: string, _args: string[], _options: SpawnOptionsWithoutStdio) => fake.child,
    );
    const execute = createBridgeExecutor({ spawn: launch, platform: "darwin" });
    const pending = execute({
      cwd: "/workspace with spaces",
      signal: new AbortController().signal,
      request: { event: "catalog", agentKind: "main" },
    });
    fake.stdout.write('{"additionalContext":"Catalog"}\n');
    fake.stderr.write("diagnostic\n");
    fake.child.emit("close", 0);
    expect(await pending).toEqual({
      stdout: '{"additionalContext":"Catalog"}\n',
      code: 0,
    });
    expect(launch.mock.calls[0]).toEqual([
      "lore",
      ["hook", "omp"],
      {
        cwd: "/workspace with spaces",
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: false,
      },
    ]);
    expect(fake.input()).toBe('{"event":"catalog","agentKind":"main"}\n');
    expect(fake.kill).toHaveBeenCalledTimes(0);
  });

  test("Windows starts only a fixed cmd shim command; user cwd never enters the shell command", async () => {
    const fake = fakeChild();
    const launch = mock(
      (_command: string, _args: string[], _options: SpawnOptionsWithoutStdio) => fake.child,
    );
    const execute = createBridgeExecutor({
      spawn: launch,
      platform: "win32",
      systemRoot: "C:\\Windows",
    });
    const pending = execute({
      cwd: "C:\\tasks\\spaces & special",
      signal: new AbortController().signal,
      request: { event: "catalog", agentKind: "main" },
    });
    fake.child.emit("close", 0);
    await pending;
    expect(launch.mock.calls[0]).toEqual([
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "lore.cmd hook omp"],
      {
        cwd: "C:\\tasks\\spaces & special",
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    ]);
    expect(fake.input()).toBe('{"event":"catalog","agentKind":"main"}\n');
  });

  test("pre-cancelled work never launches a process", async () => {
    const fake = fakeChild();
    const launch = mock(() => fake.child);
    const controller = new AbortController();
    controller.abort();
    const execute = createBridgeExecutor({ spawn: launch });
    await expect(
      execute({
        cwd: "/workspace",
        signal: controller.signal,
        request: { event: "catalog", agentKind: "main" },
      }),
    ).rejects.toThrow("cancelled");
    expect(launch).toHaveBeenCalledTimes(0);
  });

  test("cancellation during launch still terminates the child", async () => {
    const fake = fakeChild();
    const controller = new AbortController();
    const execute = createBridgeExecutor({
      spawn: () => {
        controller.abort();
        return fake.child;
      },
      platform: "darwin",
    });
    await expect(
      execute({
        cwd: "/workspace",
        signal: controller.signal,
        request: { event: "catalog", agentKind: "main" },
      }),
    ).rejects.toThrow("cancelled");
    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
    expect(fake.input()).toBe("");
  });

  test("synchronous launch failure rejects without waiting for the deadline", async () => {
    const execute = createBridgeExecutor({
      spawn: () => {
        throw new Error("ENOENT");
      },
    });
    await expect(
      execute({
        cwd: "/workspace",
        signal: new AbortController().signal,
        request: { event: "catalog", agentKind: "main" },
      }),
    ).rejects.toThrow("ENOENT");
  });

  test("cancellation kills the Unix child and rejects without waiting for process close", async () => {
    const fake = fakeChild();
    const controller = new AbortController();
    const execute = createBridgeExecutor({ spawn: () => fake.child, platform: "darwin" });
    const pending = execute({
      cwd: "/workspace",
      signal: controller.signal,
      request: { event: "catalog", agentKind: "main" },
    });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
    expect(fake.stdout.destroyed).toBe(true);
    expect(fake.stderr.destroyed).toBe(true);
  });

  test("Windows cancellation requests termination of the entire shim process tree", async () => {
    const fake = fakeChild(456);
    const killer = fakeChild(789);
    const launch = mock((command: string, _args: string[], _options: SpawnOptionsWithoutStdio) =>
      command.endsWith("taskkill.exe") ? killer.child : fake.child,
    );
    const controller = new AbortController();
    const execute = createBridgeExecutor({
      spawn: launch,
      platform: "win32",
      systemRoot: "C:\\Windows",
    });
    const pending = execute({
      cwd: "C:\\workspace",
      signal: controller.signal,
      request: { event: "catalog", agentKind: "main" },
    });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(launch.mock.calls[1]).toEqual([
      "C:\\Windows\\System32\\taskkill.exe",
      ["/PID", "456", "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
      },
    ]);
    expect(killer.unref).toHaveBeenCalledTimes(1);
  });

  test.each(["throw", "error"] as const)(
    "Windows cancellation kills the shim if taskkill cannot launch (%s)",
    async (failure) => {
      const fake = fakeChild();
      const killer = fakeChild();
      const launch = mock(
        (command: string, _args: string[], _options: SpawnOptionsWithoutStdio) => {
          if (!command.endsWith("taskkill.exe")) return fake.child;
          if (failure === "throw") throw new Error("ENOENT");
          return killer.child;
        },
      );
      const controller = new AbortController();
      const execute = createBridgeExecutor({ spawn: launch, platform: "win32" });
      const pending = execute({
        cwd: "C:\\workspace",
        signal: controller.signal,
        request: { event: "catalog", agentKind: "main" },
      });
      controller.abort();
      if (failure === "error") killer.child.emit("error", new Error("ENOENT"));
      await expect(pending).rejects.toThrow("cancelled");
      expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
    },
  );

  test("deadline rejects and kills an unresponsive subprocess", async () => {
    const fake = fakeChild();
    const execute = createBridgeExecutor({
      spawn: () => fake.child,
      platform: "darwin",
      timeoutMs: 1,
    });
    await expect(
      execute({
        cwd: "/workspace",
        signal: new AbortController().signal,
        request: { event: "catalog", agentKind: "main" },
      }),
    ).rejects.toThrow("timed out");
    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
  });

  test.each(["process", "stdin", "stdout", "stderr"] as const)(
    "%s errors reject instead of hanging the callback",
    async (channel) => {
      const fake = fakeChild();
      const execute = createBridgeExecutor({ spawn: () => fake.child, platform: "darwin" });
      const pending = execute({
        cwd: "/workspace",
        signal: new AbortController().signal,
        request: { event: "catalog", agentKind: "main" },
      });
      const source = channel === "process" ? fake.child : fake[channel];
      source.emit("error", new Error(channel === "process" ? "ENOENT" : "EPIPE"));
      await expect(pending).rejects.toThrow(channel === "process" ? "ENOENT" : "EPIPE");
    },
  );

  test("bounds captured stdout", async () => {
    const fake = fakeChild();
    const execute = createBridgeExecutor({ spawn: () => fake.child, platform: "darwin" });
    const pending = execute({
      cwd: "/workspace",
      signal: new AbortController().signal,
      request: { event: "catalog", agentKind: "main" },
    });
    fake.stdout.write("x".repeat(32_769));
    await expect(pending).rejects.toThrow("output budget");
    expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
  });

  test("successful completion removes cancellation so later invalidation cannot kill a finished process", async () => {
    const fake = fakeChild();
    const controller = new AbortController();
    const execute = createBridgeExecutor({ spawn: () => fake.child, platform: "darwin" });
    const pending = execute({
      cwd: "/workspace",
      signal: controller.signal,
      request: { event: "catalog", agentKind: "main" },
    });
    fake.child.emit("close", 0);
    await pending;
    controller.abort();
    expect(fake.kill).toHaveBeenCalledTimes(0);
  });
});

describe("Lorelum bridge stdin requests", () => {
  const requests: BridgeRequest[] = [
    {
      event: "shell",
      sessionId: "actual-session",
      command: "lore get 'practice'; echo \"$HOME\"\nnext",
    },
    { event: "read-hints", sessionId: "dispatch-parent-session" },
  ];
  for (const request of requests) {
    for (const platform of ["darwin", "win32"] as const) {
      test(`${request.event} uses stdin only on ${platform}`, async () => {
        const fake = fakeChild();
        const launch = mock(
          (_command: string, _args: string[], _options: SpawnOptionsWithoutStdio) => fake.child,
        );
        const execute = createBridgeExecutor({
          spawn: launch,
          platform,
          systemRoot: "C:\\Windows",
        });
        const pending = execute({
          cwd: "/workspace",
          signal: new AbortController().signal,
          request,
        });
        fake.child.emit("close", 0);
        await pending;
        expect(fake.input()).toBe(`${JSON.stringify(request)}\n`);
        expect(launch.mock.calls[0]![1]).toEqual(
          platform === "win32" ? ["/d", "/s", "/c", "lore.cmd hook omp"] : ["hook", "omp"],
        );
        expect(launch.mock.calls[0]![2]).not.toHaveProperty("env");
      });
    }
  }
});
