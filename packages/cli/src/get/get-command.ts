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

function sourceKey(packName: string, sourcePath: string): string {
  return packName + "\0" + sourcePath;
}

function requiredStorePackRoot(
  roots: ReadonlyMap<string, string>,
  packName: string,
  sourcePath: string,
): string {
  const packRoot = roots.get(sourceKey(packName, sourcePath));
  if (packRoot === undefined) {
    throw new StoreRecoveryRequiredError(
      "A Store source has no verified Pack locator in the current Store.",
    );
  }
  return packRoot;
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
      if (id === undefined || !ID_REGEX.test(id))
        throw invalidInvocationError("Provide a valid Practice ID. Run lore get --help for usage.");
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
          const activeSources = project.sources.filter(
            (source) => source.status === "active" && source.practiceId === id,
          );
          const storeSources = activeSources.filter((source) => source.scope === "store");
          const storeRoots = new Map<string, string>();
          if (storeSources.length > 0) {
            const located = await services.store.getEffectivePracticeWithPackRoots(root, id);
            if (located === undefined) {
              throw new StoreRecoveryRequiredError(
                "A Store source changed before its Pack locator could be read.",
              );
            }
            for (const source of located.sources) {
              storeRoots.set(sourceKey(source.packName, source.sourcePath), source.packRoot);
            }
          }
          return {
            data: {
              practice: practice.practice,
              contentDigest: practice.contentDigest,
              sources: activeSources.map((source) => ({
                packName: source.packName,
                sourcePath: source.sourcePath ?? "",
                // Project paths remain in the resolver process only. This is
                // stable, useful provenance without exposing an absolute directory.
                packRoot:
                  source.scope === "project"
                    ? `project-layer-${source.layerDepth ?? 0}`
                    : requiredStorePackRoot(storeRoots, source.packName, source.sourcePath ?? ""),
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
        if (error instanceof InvalidProjectRootError)
          throw invalidInvocationError("--project-root must point to a valid project directory.");
        throw error;
      }
    },
  };
}
