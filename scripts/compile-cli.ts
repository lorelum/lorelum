import manifest from "../packages/cli/package.json";

const extension = process.platform === "win32" ? ".exe" : "";
const filename = `lorelum-${manifest.version}-${process.platform}-${process.arch}${extension}`;
const output = `dist/${filename}`;
const artifactName = `lorelum-${manifest.version}-${process.platform}-${process.arch}`;

if (process.argv.includes("--print-path")) {
  console.log(output);
  process.exit(0);
}
if (process.argv.includes("--print-artifact-name")) {
  console.log(artifactName);
  process.exit(0);
}

const result = Bun.spawnSync({
  cmd: [process.execPath, "build", "--compile", "packages/cli/src/main.ts", "--outfile", output],
  stderr: "inherit",
  stdout: "inherit",
});

if (result.exitCode !== 0) process.exit(result.exitCode);
console.log(output);
