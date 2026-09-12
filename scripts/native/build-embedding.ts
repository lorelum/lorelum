import config from "../../native/embedding/build-config.json";
import {
  developmentEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const nativeRoot = join(repositoryRoot, "native/embedding");
const cmakeFlags = config.cmakeFlags.map((flag) =>
  flag
    .replace("@BUILD_NUMBER@", config.source.tag.slice(1))
    .replace(
      "@BUILD_COMMIT@",
      `${config.source.commit.slice(0, 8)}-lorelum.${config.patch.sha256.slice(0, 8)}`,
    ),
);
const cacheRoot = join(repositoryRoot, ".cache/native-build");
const sourceArchive = join(cacheRoot, `llama.cpp-${config.source.commit}.tar.gz`);
const sourceRoot = join(cacheRoot, "source");
const buildRoot = join(cacheRoot, "build-darwin-arm64");
const toolRoot = join(cacheRoot, "tools");
const cmakeArchive = join(toolRoot, `cmake-${config.cmake.version}-macos-universal.tar.gz`);
const cmakeExecutable = join(
  toolRoot,
  `cmake-${config.cmake.version}-macos-universal`,
  "CMake.app/Contents/bin/cmake",
);
const patchPath = join(nativeRoot, config.patch.path);

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  await Bun.write(destination, await response.arrayBuffer());
}

async function ensureDownload(
  url: string,
  destination: string,
  expectedSha256: string,
  expectedBytes?: number,
): Promise<void> {
  if (!existsSync(destination) || sha256File(destination) !== expectedSha256) {
    rmSync(destination, { force: true });
    console.log(`Downloading ${basename(destination)}...`);
    await download(url, destination);
  }
  const actualSha256 = sha256File(destination);
  const actualBytes = statSync(destination).size;
  if (
    actualSha256 !== expectedSha256 ||
    (expectedBytes !== undefined && actualBytes !== expectedBytes)
  ) {
    throw new Error(
      `artifact verification failed for ${destination}: bytes=${actualBytes}, sha256=${actualSha256}`,
    );
  }
}

function run(command: readonly string[], cwd = repositoryRoot): string {
  const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0) {
    throw new Error(
      `command failed (${result.exitCode}): ${command.join(" ")}\n${stdout}${stderr}`,
    );
  }
  return stdout.trim();
}

function copyArtifact(source: string, destination: string): void {
  copyFileSync(source, destination);
  chmodSync(destination, statSync(source).mode);
}

const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
if (artifact === undefined) {
  throw new Error(
    `this validated build recipe currently supports darwin-arm64, got ${process.platform}-${process.arch}`,
  );
}

mkdirSync(cacheRoot, { recursive: true });
mkdirSync(toolRoot, { recursive: true });

if (sha256File(patchPath) !== config.patch.sha256) {
  throw new Error(`patch digest does not match ${config.patch.path}`);
}

await ensureDownload(
  config.source.archiveUrl,
  sourceArchive,
  config.source.archiveSha256,
  config.source.archiveBytes,
);
await ensureDownload(
  config.cmake.darwinUniversalUrl,
  cmakeArchive,
  config.cmake.darwinUniversalSha256,
);

if (!existsSync(cmakeExecutable)) {
  run(["tar", "-xzf", cmakeArchive, "-C", toolRoot]);
}

rmSync(sourceRoot, { recursive: true, force: true });
rmSync(buildRoot, { recursive: true, force: true });
mkdirSync(sourceRoot, { recursive: true });
run(["tar", "-xzf", sourceArchive, "-C", sourceRoot, "--strip-components=1"]);
run(["patch", "--dry-run", "--batch", "-p1", "-i", patchPath], sourceRoot);
run(["patch", "--batch", "-p1", "-i", patchPath], sourceRoot);
if (
  !readFileSync(join(sourceRoot, "tools/server/main.cpp"), "utf8").includes(
    "start_parent_liveness_watcher",
  )
) {
  throw new Error("parent-liveness patch did not modify tools/server/main.cpp");
}

run(
  [
    "/usr/bin/env",
    `GIT_CEILING_DIRECTORIES=${repositoryRoot}`,
    cmakeExecutable,
    "-S",
    sourceRoot,
    "-B",
    buildRoot,
    ...cmakeFlags,
  ],
  sourceRoot,
);
run([cmakeExecutable, "--build", buildRoot, "--target", "llama-server", "--parallel", "4"]);

const builtExecutable = join(buildRoot, "bin/llama-server");
if (!existsSync(builtExecutable)) {
  throw new Error(`build completed without ${builtExecutable}`);
}

const outputRoot = developmentEmbeddingArtifactDirectory(artifact);
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

copyArtifact(builtExecutable, join(outputRoot, "llama-server"));
// Keep copy paths, attribution text and manifest membership together.
const licenses = [
  ["LICENSE", "LICENSE.llama.cpp", `llama.cpp ${config.source.tag} (${config.source.commit})`],
  ["vendor/cpp-httplib/LICENSE", "LICENSE.cpp-httplib", "cpp-httplib (vendored by llama.cpp)"],
  ["licenses/LICENSE-jsonhpp", "LICENSE.nlohmann-json", "nlohmann/json (vendored by llama.cpp)"],
  [
    "vendor/hash/rotate-bits/LICENSE.md",
    "LICENSE.rotate-bits",
    "rotate-bits (vendored by llama.cpp)",
  ],
  [
    "vendor/hash/sha256/LICENSE",
    "LICENSE.sha256",
    "SHA-256 implementation by Igor Pavlov (vendored by llama.cpp)",
    "Public-domain notice",
  ],
  ["vendor/hash/xxhash/LICENSE", "LICENSE.xxhash", "xxHash (vendored by llama.cpp)"],
] as const;
for (const [source, file] of licenses)
  copyFileSync(join(sourceRoot, source), join(outputRoot, file));
writeFileSync(
  join(outputRoot, "THIRD_PARTY_NOTICES.txt"),
  [
    "Lorelum embedding native runtime third-party notices",
    "",
    ...licenses.flatMap(([, file, attribution, label = "License text"]) => [
      attribution,
      `${label}: ${file}`,
      "",
    ]),
    "SHA-1 implementation by Steve Reid (vendored by llama.cpp)",
    "Declared 100% Public Domain in the source header.",
    "",
  ].join("\n"),
);

const compiler = run(["xcrun", "clang++", "--version"]).split("\n")[0] ?? "unknown";
const cmakeVersion = run([cmakeExecutable, "--version"]).split("\n")[0] ?? "unknown";
const recipeInputs = {
  schemaVersion: config.schemaVersion,
  source: config.source,
  patchSha256: config.patch.sha256,
  cmakeFlags,
  model: config.model,
};
const recipeIdentity = sha256Json(recipeInputs);
const licenseFiles = [...licenses.map(([, file]) => file), "THIRD_PARTY_NOTICES.txt"];
const artifactNames = ["llama-server", ...licenseFiles];
const files = artifactNames.map((path) => ({
  path,
  bytes: statSync(join(outputRoot, path)).size,
  sha256: sha256File(join(outputRoot, path)),
}));
// Artifact bytes, not just compiler labels, define the runtime identity.
const buildIdentity = sha256Json({ recipeIdentity, files });
const dynamicDependencies = run(["otool", "-L", join(outputRoot, "llama-server")])
  .split("\n")
  .slice(1)
  .map((line) => line.trim().split(" ")[0])
  .filter((value): value is string => Boolean(value));
const manifest = {
  schemaVersion: config.schemaVersion,
  buildIdentity,
  recipeIdentity,
  platform: process.platform,
  arch: process.arch,
  executable: "llama-server",
  source: {
    tag: config.source.tag,
    commit: config.source.commit,
    archiveSha256: config.source.archiveSha256,
  },
  patchSha256: config.patch.sha256,
  toolchain: { cmake: cmakeVersion, compiler },
  cmakeFlags,
  model: config.model,
  files,
  licenses: licenseFiles,
  dynamicDependencies,
};
writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${join(outputRoot, "llama-server")}`);
console.log(`recipeIdentity=${recipeIdentity}`);
console.log(`buildIdentity=${buildIdentity}`);
console.log(`files=${readdirSync(outputRoot).sort().join(",")}`);
