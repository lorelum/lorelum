import { expect, test } from "bun:test";
import { join } from "node:path";

async function bundledInputs(entrypoints: string[]): Promise<string[]> {
  // Isolate Bun's resolver cache between the small client and workspace server builds.
  const script = `const result = await Bun.build({ entrypoints: ${JSON.stringify(entrypoints)}, target: "bun", metafile: true });
    if (!result.success) throw new Error("Boundary build failed");
    console.log(JSON.stringify(Object.keys(result.metafile.inputs)));`;
  // process.execPath is the real bun binary; Bun.which may resolve to an
  // npm-generated .cmd shim that cannot carry cmd metacharacters in arguments.
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [output, errors, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exit).toBe(0);
  expect(errors).toBe("");
  const inputs: unknown = JSON.parse(output);
  if (
    !Array.isArray(inputs) ||
    !inputs.every((value): value is string => typeof value === "string")
  )
    throw new Error("Invalid build metadata");
  // Bun's build metafile reports native separators; matchers below assume "/".
  return inputs.map((path) => path.replace(/\\/g, "/"));
}
const engine = (path: string) => path.includes("packages/engine/src/");
const elysia = (path: string) => path.includes("node_modules/elysia/");

test("client/control/coordination import the pure method catalog without server or storage dependencies", async () => {
  // No external exclusions: follow the actual complete resolved dependency graph.
  const client = await bundledInputs([
    join(import.meta.dir, "index.ts"),
    join(import.meta.dir, "../runtime/index.ts"),
    join(import.meta.dir, "../coordination/index.ts"),
  ]);
  expect(client.some((path) => path.endsWith("client/client.ts"))).toBe(true);
  expect(client.some((path) => path.endsWith("query/semantic/methods/catalog.ts"))).toBe(true);
  for (const directory of [
    "/local-store/",
    "/query/artifacts/",
    "/query/semantic/index/",
    "/project-context/",
  ]) {
    expect(client.some((path) => engine(path) && path.includes(directory))).toBe(false);
  }
  expect(client.some(elysia)).toBe(false);
  const server = await bundledInputs([join(import.meta.dir, "../app.ts")]);
  expect(server.some(engine)).toBe(true);
  expect(server.some(elysia)).toBe(true);
  expect(server.some((path) => engine(path) && path.includes("/local-store/"))).toBe(true);
});
