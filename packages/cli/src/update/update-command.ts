import type { OutputWriter, JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { CliError, frameworkErrorCodes } from "../runtime/errors.js";
import {
  findManagedInstall,
  InstallerFailure,
  installerAvailable,
  readEntryVersion,
  runInstaller,
  type ManagedInstall,
} from "./managed-install.js";
import { listReleases } from "./release-client.js";
import {
  defaultChannel,
  releaseTarget,
  selectUpdate,
  type Release,
  type UpdateChannel,
  type UpdateResult,
} from "./version-catalog.js";
import { toolVersion } from "../output/protocol.js";

const codes = {
  unavailable: "update.unavailable",
  unsupportedPlatform: "update.unsupported-platform",
  applyUnsupported: "update.apply-unsupported",
  applyFailed: "update.apply-failed",
  verificationFailed: "update.verification-failed",
} as const;

const resultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["currentVersion", "channel", "latestVersion", "status", "canApply", "releaseNotesUrl"],
  properties: {
    currentVersion: { type: "string" },
    channel: { enum: ["stable", "prerelease"] },
    latestVersion: { oneOf: [{ type: "string" }, { const: null }] },
    status: { enum: ["available", "current", "ahead", "no-release", "updated"] },
    canApply: { type: "boolean" },
    releaseNotesUrl: { oneOf: [{ type: "string" }, { const: null }] },
    installedVersion: { type: "string" },
  },
};

export interface UpdateServices {
  readonly findInstall?: () => Promise<ManagedInstall | undefined>;
  readonly list?: (channel: UpdateChannel, target: string) => Promise<readonly Release[]>;
  readonly target?: () => string | undefined;
  readonly available?: (path: string) => Promise<boolean>;
  readonly install?: (managed: ManagedInstall, version: string) => Promise<boolean>;
  readonly entryVersion?: (managed: ManagedInstall) => Promise<string | undefined>;
  readonly progress?: OutputWriter;
}

export function createCliUpdateCommand(services: UpdateServices = {}): CommandDefinition {
  const findInstall = services.findInstall ?? findManagedInstall;
  return {
    name: "update",
    summary: "Check for a newer Lore CLI release; apply only for default installer installations.",
    positionals: [],
    options: [
      {
        longFlag: "--channel",
        description: "Select stable or prerelease releases for this check.",
        value: { name: "channel", required: true },
        values: ["stable", "prerelease"],
        optionRequired: false,
      },
      {
        longFlag: "--apply",
        description:
          "Install an available release if this CLI is managed by the default installer.",
        optionRequired: false,
      },
    ],
    resultSchema,
    errorCodes: [...frameworkErrorCodes, ...Object.values(codes)],
    exitCodes: [0, 2],
    textRenderer: renderUpdate,
    async handler(invocation) {
      const channel = (invocation.options.channel ?? defaultChannel()) as UpdateChannel;
      const apply = invocation.options.apply === true;
      const managed = await findInstall();
      if (apply && managed === undefined)
        throw new CliError(
          codes.applyUnsupported,
          "This CLI is not managed by the default Lorelum installer. Update it using its original installation method; nothing was changed.",
        );
      const target = (services.target ?? releaseTarget)();
      if (!target)
        throw new CliError(
          codes.unsupportedPlatform,
          "Lorelum has no release archive for this platform. Use a supported platform to check for updates.",
        );
      let releases: readonly Release[];
      try {
        releases = await (services.list ?? listReleases)(channel, target);
      } catch (error) {
        invocation.log?.warn("update.release-check-failed", {
          reason: error instanceof Error ? error.name : "unknown",
        });
        throw new CliError(
          codes.unavailable,
          "Could not check Lorelum releases. Check your connection or proxy and retry later; your installation was not changed.",
        );
      }
      const result = selectUpdate(toolVersion, channel, releases, managed !== undefined);
      if (!apply || result.status !== "available") return { data: { ...result } };
      // Check the entry again just before invoking the installer, so a changed
      // default command is not silently replaced by this process.
      const current = await findInstall();
      if (
        current === undefined ||
        current.entry !== managed!.entry ||
        current.executable !== managed!.executable ||
        !(await (services.available ?? installerAvailable)(current.installer))
      )
        throw new CliError(
          codes.applyUnsupported,
          "The default installer entry changed or its bundled installer is missing. Nothing was installed; use your original installer to update.",
        );
      (services.progress ?? process.stderr).write(
        `Installing Lore CLI ${result.latestVersion}...\n`,
      );
      let installed = false;
      let failureReason: InstallerFailure["reason"] = "unknown";
      try {
        installed = await (services.install ?? runInstaller)(current, result.latestVersion!);
      } catch (error) {
        // Only recognized categories cross this boundary; never relay raw
        // installer output, which could contain proxy credentials.
        if (error instanceof InstallerFailure) failureReason = error.reason;
      }
      if (!installed)
        throw new CliError(
          codes.applyFailed,
          {
            backend:
              "The installer could not safely stop the Backend, so the previous command remains active. Run lore backend status, resolve its reported problem, then retry lore update --apply.",
            download:
              "The installer could not download the release. The previous command remains active; check your network or proxy and retry lore update --apply.",
            archive:
              "The installer could not verify the release archive. The previous command remains active; inspect the official Release assets and retry later.",
            conflict:
              "The target version directory conflicts with the verified release. The previous command remains active; inspect that installation before retrying.",
            unknown:
              "The installer failed. The previous command was not switched by a successful install; Backend may have stopped. Check lore backend status, then retry lore update --apply.",
          }[failureReason],
        );
      const version = await (services.entryVersion ?? readEntryVersion)(current);
      if (version !== result.latestVersion)
        throw new CliError(
          codes.verificationFailed,
          "The installer finished, but the default lore command did not report the expected version. Check that entry; if needed, run the original installer with the previous version to recover.",
        );
      return { data: { ...result, status: "updated", installedVersion: version } };
    },
  };
}

function renderUpdate(value: JsonValue): string {
  const result = value as unknown as UpdateResult;
  const lines = [
    `Lore CLI: ${result.currentVersion}`,
    `Channel: ${result.channel}`,
    `Latest available: ${result.latestVersion ?? "none for this channel and platform"}`,
    `Installation: ${result.canApply ? "default Lorelum installer" : "other or unknown"}`,
  ];
  if (result.status === "updated") {
    lines.push(`Updated Lore CLI: ${result.currentVersion} → ${result.installedVersion}`);
    lines.push(`Verified default command: Lorelum ${result.installedVersion}`);
    lines.push("Restart an already-open agent/editor if it still uses the old CLI.");
  } else {
    const summary = {
      available: "An update is available. Nothing was changed.",
      current: "This channel is up to date. Nothing was changed.",
      ahead:
        "This CLI is newer than the published release. Nothing was changed; no downgrade is suggested.",
      "no-release": "No release is available for this channel and platform. Nothing was changed.",
    }[result.status];
    lines.push(summary);
    if (result.releaseNotesUrl) lines.push(`Release notes: ${result.releaseNotesUrl}`);
    if (result.status === "available")
      lines.push(
        result.canApply
          ? `Review them, then run: lore update --apply${result.channel !== defaultChannel() ? ` --channel ${result.channel}` : ""}`
          : "Update using your original installation method.",
      );
  }
  return lines.join("\n");
}
