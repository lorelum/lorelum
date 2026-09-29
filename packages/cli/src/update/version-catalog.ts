import { toolVersion } from "../output/protocol.js";

export type UpdateChannel = "stable" | "prerelease";
export type UpdateStatus = "available" | "current" | "ahead" | "no-release" | "updated";

export interface Release {
  readonly version: string;
  readonly notesUrl: string;
}

export interface UpdateResult {
  readonly currentVersion: string;
  readonly channel: UpdateChannel;
  readonly latestVersion: string | null;
  readonly status: UpdateStatus;
  readonly canApply: boolean;
  readonly releaseNotesUrl: string | null;
  readonly installedVersion?: string;
}

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function normalizeVersion(tag: string): string | undefined {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const match = semverPattern.exec(version);
  if (
    !match ||
    match[4]?.split(".").some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith("0"))
  )
    return undefined;
  return version;
}

export function defaultChannel(version = toolVersion): UpdateChannel {
  return version.split("+")[0]!.includes("-") ? "prerelease" : "stable";
}

export function releaseTarget(
  platform = process.platform,
  arch = process.arch,
): string | undefined {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  return undefined;
}

export function selectUpdate(
  currentVersion: string,
  channel: UpdateChannel,
  releases: readonly Release[],
  canApply: boolean,
): UpdateResult {
  const latest = [...releases].sort((a, b) => Bun.semver.order(b.version, a.version))[0];
  const order = latest === undefined ? 0 : Bun.semver.order(latest.version, currentVersion);
  return {
    currentVersion,
    channel,
    latestVersion: latest?.version ?? null,
    status:
      latest === undefined
        ? "no-release"
        : order > 0
          ? "available"
          : order < 0
            ? "ahead"
            : "current",
    canApply,
    releaseNotesUrl: latest?.notesUrl ?? null,
  };
}
