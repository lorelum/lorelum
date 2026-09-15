import {
  InvalidProjectRootError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  type LocalStore,
  type StorageRoot,
} from "@lorelum/engine";
import { ID_REGEX } from "@lorelum/format";

import type { CommandDefinition } from "../registry.js";
import {
  CliError,
  cliErrorCodes,
  frameworkErrorCodes,
  invalidInvocationError,
} from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";
import {
  resolveProjectInvocationOptions,
  type ProjectContextResolver,
} from "../project-context/service.js";
import { getResultSchema } from "./result-schema.js";

export interface GetCommandServices {
  readonly store: Pick<LocalStore, "getEffectivePracticeWithPackRoots">;
  readonly storageRoot: StorageRoot;
  /** Optional injection preserves isolated Store-only command tests. */
  readonly resolveProjectContext?: ProjectContextResolver;
}

export function createGetCommand(services: GetCommandServices): CommandDefinition {
  return {
    name: "get",
    summary: "Read one current Practice by its exact ID from the selected query context.",
    positionals: [{ name: "practice-id", required: true }],
    options: [],
    resultSchema: getResultSchema,
    errorCodes: [
      ...frameworkErrorCodes,
      cliErrorCodes.practiceNotFound,
      cliErrorCodes.storeBusy,
      cliErrorCodes.storeRecoveryRequired,
    ],
    exitCodes: [0, 2],
    async handler(invocation) {
      const id = invocation.positionals[0];
      if (id === undefined || !ID_REGEX.test(id)) throw invalidInvocationError();
      const root = resolveInvocationStorageRoot(invocation.options.storeRoot, services.storageRoot);
      try {
        const project =
          services.resolveProjectContext === undefined
            ? undefined
            : await services.resolveProjectContext(
                root,
                resolveProjectInvocationOptions(invocation.options),
              );
        if (project !== undefined) {
          const practice = project.practices.find((candidate) => candidate.practiceId === id);
          if (practice === undefined) {
            throw new CliError(
              cliErrorCodes.practiceNotFound,
              "The requested Practice was not found in the selected query context.",
            );
          }
          return {
            data: {
              practice: practice.practice,
              contentDigest: practice.contentDigest,
              sources: project.sources
                .filter((source) => source.status === "active" && source.practiceId === id)
                .map((source) => ({
                  packName: source.packName,
                  sourcePath: source.sourcePath ?? "",
                  // Project paths remain in the resolver process only. This is
                  // stable, useful provenance without exposing an absolute directory.
                  packRoot:
                    source.scope === "project"
                      ? `project-layer-${source.layerDepth ?? 0}`
                      : "selected-store",
                })),
            },
          };
        }
        const result = await services.store.getEffectivePracticeWithPackRoots(root, id);
        if (result === undefined) {
          throw new CliError(
            cliErrorCodes.practiceNotFound,
            "The requested Practice was not found in the selected local Store.",
          );
        }
        return {
          data: {
            practice: result.effectivePractice.practice,
            contentDigest: result.effectivePractice.contentDigest,
            sources: result.sources.map(({ packName, sourcePath, packRoot }) => ({
              packName,
              sourcePath,
              packRoot,
            })),
          },
        };
      } catch (error) {
        if (error instanceof StoreBusyError) {
          throw new CliError(cliErrorCodes.storeBusy, "The local Pack store is busy.");
        }
        if (error instanceof StoreRecoveryRequiredError) {
          throw new CliError(
            cliErrorCodes.storeRecoveryRequired,
            "The local Pack store requires recovery.",
          );
        }
        if (error instanceof InvalidProjectRootError) throw invalidInvocationError();
        throw error;
      }
    },
  };
}
