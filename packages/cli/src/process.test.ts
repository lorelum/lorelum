import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entrypoint = join(import.meta.dir, "main.ts");
const bunExecutable = Bun.which("bun");

test("source and compiled binaries preserve the version protocol", async () => {
  if (bunExecutable === null) {
    throw new Error("Bun executable is required for CLI process tests.");
  }

  const source = await runProcess([bunExecutable, entrypoint, "--version"]);
  expect(source.exitCode).toBe(0);
  expect(JSON.parse(source.stdout)).toMatchObject({ command: "version", ok: true });
  expect(source.stderr).toBe("");

  const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-"));
  const executable = join(directory, process.platform === "win32" ? "lore.exe" : "lore");

  try {
    const build = await runProcess([
      bunExecutable,
      "build",
      "--compile",
      entrypoint,
      "--outfile",
      executable,
    ]);
    expect(build.exitCode).toBe(0);

    const binary = await runProcess([executable, "--version"]);
    expect(binary.exitCode).toBe(0);
    expect(JSON.parse(binary.stdout)).toMatchObject({ command: "version", ok: true });
    expect(binary.stderr).toBe("");

    const discovery = await runProcess([executable]);
    expect(discovery.exitCode).toBe(0);
    expect(JSON.parse(discovery.stdout)).toMatchObject({ command: "describe", ok: true });
    expect(discovery.stderr).toBe("");

    const packDirectory = join(directory, "pack");
    await mkdir(packDirectory);
    await writeFile(join(packDirectory, "pack.yaml"), "name: process-pack\nversion: 1.0.0\n");

    const valid = await runProcess([executable, "validate", packDirectory]);
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({
      command: "validate",
      ok: true,
      data: { valid: true },
    });
    expect(valid.stderr).toBe("");

    await writeFile(join(packDirectory, "decisions.yaml"), "id: process.entry\n");
    const invalidDecisionsContainer = await runProcess([executable, "validate", packDirectory]);
    expect(invalidDecisionsContainer.exitCode).toBe(1);
    expect(JSON.parse(invalidDecisionsContainer.stdout)).toMatchObject({
      command: "validate",
      ok: true,
      data: {
        valid: false,
        errors: [expect.objectContaining({ code: "format", path: "decisions" })],
      },
    });
    expect(invalidDecisionsContainer.stderr).toBe("");

    const lenientDecisionsContainer = await runProcess([
      executable,
      "validate",
      packDirectory,
      "--lenient",
    ]);
    expect(lenientDecisionsContainer.exitCode).toBe(0);
    expect(JSON.parse(lenientDecisionsContainer.stdout)).toMatchObject({
      command: "validate",
      ok: true,
      data: { valid: false, errors: [expect.objectContaining({ path: "decisions" })] },
    });

    await writeFile(join(packDirectory, "decisions.yaml"), "");
    const emptyDecisions = await runProcess([executable, "validate", packDirectory]);
    expect(emptyDecisions.exitCode).toBe(1);
    expect(JSON.parse(emptyDecisions.stdout)).toMatchObject({
      command: "validate",
      ok: true,
      data: {
        valid: false,
        errors: [expect.objectContaining({ code: "format", path: "decisions" })],
      },
    });
    expect(emptyDecisions.stderr).toBe("");

    await writeFile(
      join(packDirectory, "decisions.yaml"),
      `- id: process.entry
  question: What next?
  branches:
    - when: always
      recommend: [process.missing]
      reason: Exercise validation failure
`,
    );
    const invalidPack = await runProcess([executable, "validate", packDirectory]);
    expect(invalidPack.exitCode).toBe(1);
    expect(JSON.parse(invalidPack.stdout)).toMatchObject({
      command: "validate",
      ok: true,
      data: { valid: false, errors: [expect.objectContaining({ code: "dangling-ref" })] },
    });
    expect(invalidPack.stderr).toBe("");

    const invalid = await runProcess([executable, "--private-token"]);
    expect(invalid.exitCode).toBe(2);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      command: "unknown",
      ok: false,
      error: { code: "usage.invalid" },
    });
    expect(invalid.stdout).not.toContain("private-token");
    expect(invalid.stderr).toBe("");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}, 60_000);

async function runProcess(
  command: string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn({ cmd: command, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
}
