import { expect, test } from "bun:test";
import { join } from "node:path";

async function bundledInputs(entrypoints: string[]): Promise<string[]> {
  // Isolate Bun's resolver cache between the small client and workspace server builds.
  const script = `const result = await Bun.build({ entrypoints: ${JSON.stringify(entrypoints)}, target: "bun", metafile: true });
    if (!result.success) throw new Error("Boundary build failed");
    console.log(JSON.stringify(Object.keys(result.metafile.inputs)));`;
  const process = Bun.spawn([Bun.which("bun")!, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [output, errors, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  expect(exit).toBe(0);
  expect(errors).toBe("");
  const inputs: unknown = JSON.parse(output);
  if (
    !Array.isArray(inputs) ||
    !inputs.every((value): value is string => typeof value === "string")
  )
    throw new Error("Invalid build metadata");
  return inputs;
}
const engine = (path: string) => path.includes("packages/engine/src/");
const elysia = (path: string) => path.includes("node_modules/elysia/");

test("client exports exclude server dependencies; server build is the positive control", async () => {
  // No external exclusions: follow the actual complete resolved dependency graph.
  const client = await bundledInputs([join(import.meta.dir, "index.ts")]);
  expect(client.some((path) => path.endsWith("client/client.ts"))).toBe(true);
  expect(client.some(engine)).toBe(false);
  expect(client.some(elysia)).toBe(false);
  const server = await bundledInputs([join(import.meta.dir, "../app.ts")]);
  expect(server.some(engine)).toBe(false);
  expect(server.some(elysia)).toBe(true);
});
