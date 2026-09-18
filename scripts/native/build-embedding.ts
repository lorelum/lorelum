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
import { basename, join, resolve } from "node:path";
import config from "../../native/embedding/build-config.json";
import {
  developmentEmbeddingArtifactDirectory,
  resolveEmbeddingNativeArtifact,
  type EmbeddingNativeArtifact,
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
import { win32NativeToolchain } from "./win32-toolchain";

const repositoryRoot = resolve(import.meta.dir, "../..");
const worktreeBuildRoot = nativeBuildWorktreeDirectory(repositoryRoot);
const sourceRoot = patchedLlamaSourceDirectory(repositoryRoot);
const toolRoot = join(worktreeBuildRoot, "tools");

const artifact = resolveEmbeddingNativeArtifact(process.platform, process.arch);
if (artifact === undefined) {
  throw new Error(
    `this validated build recipe currently supports darwin-arm64, linux-x64, and win32-x64, got ${process.platform}-${process.arch}`,
  );
}
const buildRoot = join(worktreeBuildRoot, `build-${artifact.id}`);
const upstreamExecutableName = artifact.platform === "win32" ? "llama-server.exe" : "llama-server";
const artifactExecutableName = artifact.platform === "win32" ? "lore-model.exe" : "lore-model";

const recipe = targetRecipe(artifact);
const cmakeFlags = recipe.cmakeFlags.map((flag) =>
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

/** Per-target inputs: flags always, a pinned CMake download only where the recipe pins one. */
function targetRecipe(target: EmbeddingNativeArtifact): {
  readonly cmakeFlags: readonly string[];
  readonly cmake?: {
    readonly version: string;
    readonly darwinUniversalUrl: string;
    readonly darwinUniversalSha256: string;
    readonly win64Url?: string;
    readonly win64Bytes?: number;
    readonly win64Sha256?: string;
  };
} {
  if (target.platform === "darwin" && target.id === "darwin-arm64")
    return config.targets["darwin-arm64"];
  if (target.platform === "linux" && target.id === "linux-x64") return config.targets["linux-x64"];
  if (target.platform === "win32" && target.id === "win32-x64") return config.targets["win32-x64"];
  throw new Error(`unsupported build target ${target.id}`);
}

/** Toolchain resolution differs per target; the recipe and manifest shape stay shared. */
interface TargetToolchain {
  readonly cmakeExecutable: string;
  readonly cmakeVersion: string;
  /** Cache-key input; the pinned archive digest on darwin and win32, empty for system CMake. */
  readonly cmakeArchiveSha256: string;
  readonly compiler: string;
  /** Cache-key input standing in for the OS runtime ABI: macOS SDK, Linux glibc, Windows build. */
  readonly platformFingerprint: string;
  /** Extra environment for every toolchain child; Windows replaces PATH to keep builds clean. */
  readonly spawnEnvironment?: Readonly<Record<string, string>>;
  prepare(): Promise<void>;
  dynamicDependencies(executable: string): string[];
}

function darwinToolchain(): TargetToolchain {
  const pinned = recipe.cmake;
  if (pinned === undefined) throw new Error("darwin-arm64 recipe must pin its CMake download");
  const cmakeArchive = join(toolRoot, `cmake-${pinned.version}-macos-universal.tar.gz`);
  const cmakeExecutable = join(
    toolRoot,
    `cmake-${pinned.version}-macos-universal`,
    "CMake.app/Contents/bin/cmake",
  );
  return {
    cmakeExecutable,
    cmakeVersion: pinned.version,
    cmakeArchiveSha256: pinned.darwinUniversalSha256,
    compiler: run(["xcrun", "clang++", "--version"]).split("\n")[0] ?? "unknown",
    platformFingerprint: run(["xcrun", "--show-sdk-version"]),
    spawnEnvironment: { GIT_CEILING_DIRECTORIES: repositoryRoot },
    async prepare() {
      mkdirSync(worktreeBuildRoot, { recursive: true });
      mkdirSync(toolRoot, { recursive: true });
      await ensurePinnedDownload({
        url: pinned.darwinUniversalUrl,
        destination: cmakeArchive,
        sha256: pinned.darwinUniversalSha256,
      });
      if (!existsSync(cmakeExecutable)) run(["tar", "-xzf", cmakeArchive, "-C", toolRoot]);
    },
    dynamicDependencies(executable) {
      return run(["otool", "-L", executable])
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(" ")[0])
        .filter((value): value is string => Boolean(value));
    },
  };
}

function linuxToolchain(): TargetToolchain {
  return {
    cmakeExecutable: "cmake",
    cmakeVersion: run(["cmake", "--version"]).split("\n")[0] ?? "unknown",
    cmakeArchiveSha256: "",
    compiler: run(["c++", "--version"]).split("\n")[0] ?? "unknown",
    // glibc decides which systems the dynamically linked llama-server can start on.
    platformFingerprint: run(["ldd", "--version"]).split("\n")[0] ?? "unknown",
    spawnEnvironment: { GIT_CEILING_DIRECTORIES: repositoryRoot },
    async prepare() {
      // Linux builds use the distribution CMake; the version above already gated its presence.
    },
    dynamicDependencies(executable) {
      const output = run(["ldd", executable]);
      if (output.length === 0) throw new Error("ldd produced no dependency output");
      const sonames = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("/"))
        .map((line) => line.split(/\s+/)[0] ?? "")
        .map((name) => basename(name))
        .filter(
          (name) =>
            /^lib.+\.so(\.[0-9]+)*$/.test(name) &&
            name !== "linux-vdso.so.1" &&
            name !== "linux-gate.so.1",
        );
      // The recipe always links the C++ runtime dynamically; an empty set means the
      // ldd output format changed, not that the binary has no dependencies.
      if (sonames.length === 0 && !output.includes("not a dynamic executable"))
        throw new Error(`could not parse ldd output for ${executable}`);
      return sonames;
    },
  };
}

const toolchain =
  artifact.platform === "darwin"
    ? darwinToolchain()
    : artifact.platform === "win32"
      ? win32Toolchain()
      : linuxToolchain();

function win32Toolchain(): TargetToolchain {
  const pinned = recipe.cmake;
  if (pinned === undefined || pinned.win64Sha256 === undefined)
    throw new Error("win32-x64 recipe must pin its CMake download");
  const windows = win32NativeToolchain(repositoryRoot);
  return {
    cmakeExecutable: windows.cmakeExecutable,
    cmakeVersion: windows.cmakeIdentity,
    cmakeArchiveSha256: pinned.win64Sha256,
    // Identities derive from the pinned archive digests so a cache hit needs no toolchain run.
    compiler: windows.compilerIdentity,
    platformFingerprint: windows.windowsVersion,
    spawnEnvironment: {
      ...windows.childEnvironment,
      GIT_CEILING_DIRECTORIES: repositoryRoot,
    },
    prepare: () => windows.prepare(),
    dynamicDependencies: (executable) => windows.dynamicDependencies(executable),
  };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(
  command: readonly string[],
  cwd = repositoryRoot,
  extraEnvironment?: Readonly<Record<string, string>>,
): string {
  const result = Bun.spawnSync([...command], {
    cwd,
    ...(extraEnvironment === undefined ? {} : { env: { ...process.env, ...extraEnvironment } }),
    stdout: "pipe",
    stderr: "pipe",
  });
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

function buildNativeArtifact(outputRoot: string): NativeArtifactManifest {
  rmSync(buildRoot, { recursive: true, force: true });
  run([toolchain.cmakeExecutable, "-S", sourceRoot, "-B", buildRoot, ...cmakeFlags], sourceRoot, {
    GIT_CEILING_DIRECTORIES: repositoryRoot,
    ...toolchain.spawnEnvironment,
  });
  run(
    [
      toolchain.cmakeExecutable,
      "--build",
      buildRoot,
      "--target",
      "llama-server",
      "--parallel",
      "4",
    ],
    repositoryRoot,
    toolchain.spawnEnvironment,
  );

  const builtExecutable = join(buildRoot, "bin", upstreamExecutableName);
  if (!existsSync(builtExecutable)) throw new Error(`build completed without ${builtExecutable}`);

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  copyArtifact(builtExecutable, join(outputRoot, artifactExecutableName));
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
  const files = [artifactExecutableName, ...licenseFiles].map((path) => ({
    path,
    bytes: statSync(join(outputRoot, path)).size,
    sha256: sha256File(join(outputRoot, path)),
  }));
  const manifest: NativeArtifactManifest = {
    schemaVersion: 1,
    buildIdentity: stableSha256({ recipeIdentity, files }),
    recipeIdentity,
    platform: artifact.platform,
    arch: artifact.arch,
    executable: artifactExecutableName,
    source: {
      tag: config.source.tag,
      commit: config.source.commit,
      archiveSha256: config.source.archiveSha256,
    },
    patchSha256: config.patch.sha256,
    toolchain: {
      cmake: run([toolchain.cmakeExecutable, "--version"]).split("\n")[0] ?? "unknown",
      compiler: toolchain.compiler,
    },
    cmakeFlags,
    model: config.model,
    files,
    licenses: licenseFiles,
    dynamicDependencies: toolchain.dynamicDependencies(join(outputRoot, artifactExecutableName)),
  };
  writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

assertNativePatchDigest(repositoryRoot);

const recipeIdentity = stableSha256({
  schemaVersion: config.schemaVersion,
  source: config.source,
  patchSha256: config.patch.sha256,
  cmakeFlags,
  model: config.model,
});
const cacheKey = nativeBuildCacheKey({
  target: artifact.id,
  recipeIdentity,
  cmakeVersion: toolchain.cmakeVersion,
  cmakeArchiveSha256: toolchain.cmakeArchiveSha256,
  compiler: toolchain.compiler,
  sdkVersion: toolchain.platformFingerprint,
});
const manifest = await materializeNativeBuildCache({
  cacheRoot: nativeBuildCacheRoot(),
  target: artifact.id,
  cacheKey,
  candidateDirectory: developmentEmbeddingArtifactDirectory(artifact),
  validate: (candidate) => assertSourceNativeArtifactMatch(artifact.manifest, candidate),
  async build(outputDirectory) {
    await toolchain.prepare();
    await materializePatchedLlamaSource(repositoryRoot);
    buildNativeArtifact(outputDirectory);
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
