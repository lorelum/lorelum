import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import config from "../../native/embedding/build-config.json";
import {
  developmentEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
} from "../../packages/backend/src/runtime/native/embedding/catalog";
import {
  assertSourceNativeArtifactMatch,
  type NativeArtifactManifest,
} from "../../packages/backend/src/runtime/native/embedding/manifest";
import { nativeBuildCacheKey, nativeBuildCacheRoot, stableSha256 } from "./cache-paths";
import { materializeNativeBuildCache } from "./cache-store";
import { ensurePinnedDownload } from "./download";
import {
  assertNativePatchDigest,
  materializePatchedLlamaSource,
  nativeBuildWorktreeDirectory,
  patchedLlamaSourceDirectory,
} from "./source-tree";

const repositoryRoot = resolve(import.meta.dir, "../..");
const worktreeBuildRoot = nativeBuildWorktreeDirectory(repositoryRoot);
const sourceRoot = patchedLlamaSourceDirectory(repositoryRoot);
const buildRoot = join(worktreeBuildRoot, "build-darwin-arm64");
const toolRoot = join(worktreeBuildRoot, "tools");
const cmakeArchive = join(toolRoot, `cmake-${config.cmake.version}-macos-universal.tar.gz`);
const cmakeExecutable = join(
  toolRoot,
  `cmake-${config.cmake.version}-macos-universal`,
  "CMake.app/Contents/bin/cmake",
);
const cmakeFlags = config.cmakeFlags.map((flag) =>
  flag
    .replace("@BUILD_NUMBER@", config.source.tag.slice(1))
    .replace(
      "@BUILD_COMMIT@",
      `${config.source.commit.slice(0, 8)}-lorelum.${config.patch.sha256.slice(0, 8)}`,
    ),
);
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

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(command: readonly string[], cwd = repositoryRoot): string {
  const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0)
    throw new Error(
      `command failed (${result.exitCode}): ${command.join(" ")}\n${stdout}${stderr}`,
    );
  return stdout.trim();
}

function copyArtifact(source: string, destination: string): void {
  copyFileSync(source, destination);
  chmodSync(destination, statSync(source).mode);
}

async function prepareBuildInputs(): Promise<void> {
  mkdirSync(worktreeBuildRoot, { recursive: true });
  mkdirSync(toolRoot, { recursive: true });
  await ensurePinnedDownload({
    url: config.cmake.darwinUniversalUrl,
    destination: cmakeArchive,
    sha256: config.cmake.darwinUniversalSha256,
  });
  if (!existsSync(cmakeExecutable)) run(["tar", "-xzf", cmakeArchive, "-C", toolRoot]);
}

function buildNativeArtifact(outputRoot: string, compiler: string): NativeArtifactManifest {
  rmSync(buildRoot, { recursive: true, force: true });
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
  if (!existsSync(builtExecutable)) throw new Error(`build completed without ${builtExecutable}`);

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  copyArtifact(builtExecutable, join(outputRoot, "llama-server"));
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

  const recipeIdentity = stableSha256({
    schemaVersion: config.schemaVersion,
    source: config.source,
    patchSha256: config.patch.sha256,
    cmakeFlags,
    model: config.model,
  });
  const licenseFiles = [...licenses.map(([, file]) => file), "THIRD_PARTY_NOTICES.txt"];
  const files = ["llama-server", ...licenseFiles].map((path) => ({
    path,
    bytes: statSync(join(outputRoot, path)).size,
    sha256: sha256File(join(outputRoot, path)),
  }));
  const manifest: NativeArtifactManifest = {
    schemaVersion: 1,
    buildIdentity: stableSha256({ recipeIdentity, files }),
    recipeIdentity,
    platform: "darwin",
    arch: "arm64",
    executable: "llama-server",
    source: {
      tag: config.source.tag,
      commit: config.source.commit,
      archiveSha256: config.source.archiveSha256,
    },
    patchSha256: config.patch.sha256,
    toolchain: {
      cmake: run([cmakeExecutable, "--version"]).split("\n")[0] ?? "unknown",
      compiler,
    },
    cmakeFlags,
    model: config.model,
    files,
    licenses: licenseFiles,
    dynamicDependencies: run(["otool", "-L", join(outputRoot, "llama-server")])
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(" ")[0])
      .filter((value): value is string => Boolean(value)),
  };
  writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
if (artifact === undefined) {
  throw new Error(
    `this validated build recipe currently supports darwin-arm64, got ${process.platform}-${process.arch}`,
  );
}
assertNativePatchDigest(repositoryRoot);

const recipeIdentity = stableSha256({
  schemaVersion: config.schemaVersion,
  source: config.source,
  patchSha256: config.patch.sha256,
  cmakeFlags,
  model: config.model,
});
const compiler = run(["xcrun", "clang++", "--version"]).split("\n")[0] ?? "unknown";
const sdkVersion = run(["xcrun", "--show-sdk-version"]);
const cacheKey = nativeBuildCacheKey({
  target: artifact.id,
  recipeIdentity,
  cmakeVersion: config.cmake.version,
  cmakeArchiveSha256: config.cmake.darwinUniversalSha256,
  compiler,
  sdkVersion,
});
const manifest = await materializeNativeBuildCache({
  cacheRoot: nativeBuildCacheRoot(),
  target: artifact.id,
  cacheKey,
  candidateDirectory: developmentEmbeddingArtifactDirectory(artifact),
  validate: (candidate) => assertSourceNativeArtifactMatch(artifact.manifest, candidate),
  async build(outputDirectory) {
    await prepareBuildInputs();
    await materializePatchedLlamaSource(repositoryRoot);
    buildNativeArtifact(outputDirectory, compiler);
  },
  report: (message) => console.log(message),
});

console.log(`Native candidate ready at ${developmentEmbeddingArtifactDirectory(artifact)}`);
console.log(`recipeIdentity=${manifest.recipeIdentity}`);
console.log(`buildIdentity=${manifest.buildIdentity}`);
console.log(
  `files=${manifest.files
    .map((file) => file.path)
    .sort()
    .join(",")}`,
);
