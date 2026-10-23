import { PROTOCOL_VERSION } from "@lorelum/backend/protocol";
import type { BuildInfo } from "@lorelum/backend/protocol";
import { currentBuildInfo } from "@lorelum/backend/control";

import { protocolVersion, toolVersion } from "./output/protocol.js";

export type VersionData = Readonly<
  BuildInfo & { protocolVersion: number; backendProtocolVersion: number }
>;

export async function createVersionData(entrypoint: string): Promise<VersionData> {
  return Object.freeze({
    protocolVersion,
    backendProtocolVersion: PROTOCOL_VERSION,
    ...(await currentBuildInfo(entrypoint, toolVersion)),
  });
}
