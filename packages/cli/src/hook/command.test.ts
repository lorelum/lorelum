import { describe, expect, test } from "bun:test";
import { run } from "../main.js";
import { parseHookInvocation } from "./command.js";

class MemoryWriter {
  value = "";
  write(message: string): void {
    this.value += message;
  }
}

describe("Hook command selection", () => {
  test.each(["codex", "claude", "cursor", "workbuddy", "zcode", "omp"] as const)(
    "%s accepts Store overrides in either position and preserves its host identity",
    (host) => {
      expect(parseHookInvocation(["hook", host, "--store-root", "isolated-store"])).toEqual({
        host,
        storeRoot: "isolated-store",
      });
      expect(parseHookInvocation(["--store-root=isolated-store", "hook", host])).toEqual({
        host,
        storeRoot: "isolated-store",
      });
      expect(parseHookInvocation(["hook", host, "extra"])).toBeUndefined();
    },
  );

  test.each([{ argv: ["--debug", "hook", "codex"] }, { argv: ["hook", "codex", "--debug"] }])(
    "accepts debug in argv %j",
    ({ argv }) => {
      expect(parseHookInvocation(argv)).toEqual({ host: "codex", debug: true });
    },
  );

  test.each([
    { argv: ["hook", "omp", "extra"] },
    { argv: ["hook", "omp", "--json"] },
    { argv: ["hook", "omp", "--store-root"] },
    { argv: ["hook", "omp", "--store-root="] },
    { argv: ["hook", "omp", "--debug", "--debug"] },
    { argv: ["hook", "omp", "--store-root=/one", "--store-root=/two"] },
    { argv: ["hook", "pi"] },
  ])("rejects invalid argv %j through ordinary CLI usage errors", async ({ argv }) => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    let inputRead = false;
    const exitCode = await run([...argv], {
      stdin: {
        async text() {
          inputRead = true;
          return '{"event":"catalog"}';
        },
      },
      stdout,
      stderr,
    });
    expect(exitCode).toBe(2);
    expect(inputRead).toBe(false);
  });
});
