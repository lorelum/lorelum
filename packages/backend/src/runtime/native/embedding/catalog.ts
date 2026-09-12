import { join, resolve } from "node:path";
import darwinArm64Manifest from "./darwin-arm64.json";

const backendPackageRoot = resolve(import.meta.dir, "../../../..");
const developmentEmbeddingArtifactRoot = join(
  backendPackageRoot,
  ".artifacts",
  "native",
  "embedding",
);

const embeddingNativeArtifacts = [
  {
    id: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    compileTarget: "bun-darwin-arm64",
    manifest: darwinArm64Manifest,
  },
] as const satisfies readonly {
  readonly id: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly compileTarget: Bun.Build.CompileTarget;
  readonly manifest: typeof darwinArm64Manifest;
}[];

export type EmbeddingNativeArtifact = (typeof embeddingNativeArtifacts)[number];

/** Return the shipped embedding runtime for one OS and architecture, if supported. */
export function resolveEmbeddingNativeArtifact(
  platform: NodeJS.Platform,
  arch: string,
): EmbeddingNativeArtifact | undefined {
  return embeddingNativeArtifacts.find(
    (artifact) => artifact.platform === platform && artifact.arch === arch,
  );
}

/** Development candidates are private to the backend package, never release output. */
export function developmentEmbeddingArtifactDirectory(artifact: EmbeddingNativeArtifact): string {
  return join(developmentEmbeddingArtifactRoot, artifact.id);
}

/** Installed artifacts remain adjacent to the compiled executable's resolved release root. */
export function installedEmbeddingArtifactDirectory(
  releaseRoot: string,
  artifact: EmbeddingNativeArtifact,
): string {
  return join(releaseRoot, "native", artifact.id);
}

/** The compiler replaces this static JSON input with the verified candidate manifest. */
export function trustedEmbeddingManifestPath(artifact: EmbeddingNativeArtifact): string {
  return join(import.meta.dir, `${artifact.id}.json`);
}
