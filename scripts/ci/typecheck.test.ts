import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  releaseTypecheckConfig,
  resolveTypecheckWorkers,
  runTypecheck,
  typecheckCommand,
  workspaceTypecheckConfigs,
} from "./typecheck";

test("uses the root native tsc binary for every configuration", () => {
  const command = typecheckCommand("packages/engine/tsconfig.json", "/repository");

  expect(command).toEqual([
    join("/repository", "node_modules", ".bin", "tsc"),
    "--noEmit",
    "-p",
    "packages/engine/tsconfig.json",
  ]);
});

test("keeps all workspace checks ahead of the release-script check", async () => {
  const configs: string[] = [];
  const exitCode = await runTypecheck({
    maxWorkers: 2,
    repositoryRoot: "/repository",
    runCommand: async (command) => {
      configs.push(command[3] ?? "");
      return 0;
    },
  });

  expect(exitCode).toBe(0);
  expect(configs).toHaveLength(workspaceTypecheckConfigs.length + 1);
  expect(new Set(configs.slice(0, -1))).toEqual(new Set(workspaceTypecheckConfigs));
  expect(configs.at(-1)).toBe(releaseTypecheckConfig);
});

test("does not run release scripts after a workspace typecheck failure", async () => {
  const configs: string[] = [];
  const exitCode = await runTypecheck({
    maxWorkers: 2,
    repositoryRoot: "/repository",
    runCommand: async (command) => {
      const config = command[3] ?? "";
      configs.push(config);
      return config === "packages/backend/tsconfig.json" ? 1 : 0;
    },
  });

  expect(exitCode).toBe(1);
  expect(configs).not.toContain(releaseTypecheckConfig);
});

test("bounds explicit worker counts and rejects invalid input", () => {
  expect(resolveTypecheckWorkers(undefined)).toBe(workspaceTypecheckConfigs.length);
  expect(resolveTypecheckWorkers("4")).toBe(4);
  expect(resolveTypecheckWorkers("999")).toBe(workspaceTypecheckConfigs.length);
  expect(() => resolveTypecheckWorkers("0")).toThrow("positive integer");
  expect(() => resolveTypecheckWorkers("two")).toThrow("positive integer");
});
