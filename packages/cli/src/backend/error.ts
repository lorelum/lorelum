import { BackendError, EmbeddingError, type BuildInfo } from "@lorelum/backend/protocol";
import { CliError } from "../runtime/errors";
import { toolVersion } from "../output/protocol";

/** CLI-only provenance enrichment; ordinary errors do not inspect the current checkout. */
export async function backendCliError(
  error: BackendError | EmbeddingError,
  knownBuild?: BuildInfo,
): Promise<CliError> {
  if (error.code !== "backend.protocol-mismatch")
    return new CliError(
      error.code,
      error.message,
      error instanceof EmbeddingError ? error.resource : undefined,
    );
  const build =
    knownBuild ??
    (await import("@lorelum/backend/control")
      .then(({ currentBuildInfo }) => currentBuildInfo(Bun.main, toolVersion))
      .catch(() => undefined));
  const identity =
    build === undefined
      ? `${toolVersion}, build unknown`
      : `${build.toolVersion}, ${build.buildKind}, revision ${build.revision ?? "unknown"}${build.dirty === true ? " dirty" : ""}, build ${build.buildIdentity}`;
  return new CliError(error.code, `${error.message} CLI build: ${identity}.`);
}
