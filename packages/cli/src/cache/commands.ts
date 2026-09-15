import { projectCacheStatus, pruneProjectCache } from "@lorelum/engine";

import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import { frameworkErrorCodes } from "../runtime/errors";
import { resolveProjectInvocationOptions } from "../project-context/service";

const cacheStatusSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "artifactCount",
    "keywordArtifactCount",
    "semanticArtifactCount",
    "progressArtifactCount",
    "artifactByteSize",
    "vectorCount",
    "vectorByteSize",
    "catalogArtifactCount",
  ],
  properties: {
    artifactCount: { type: "integer" },
    keywordArtifactCount: { type: "integer" },
    semanticArtifactCount: { type: "integer" },
    progressArtifactCount: { type: "integer" },
    artifactByteSize: { type: "integer" },
    vectorCount: { type: "integer" },
    vectorByteSize: { type: "integer" },
    catalogArtifactCount: { type: "integer" },
  },
};

const cachePruneSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "removedArtifactCount",
    "skippedArtifactCount",
    "removedArtifactByteSize",
    "removedVectorByteSize",
  ],
  properties: {
    removedArtifactCount: { type: "integer" },
    skippedArtifactCount: { type: "integer" },
    removedArtifactByteSize: { type: "integer" },
    removedVectorByteSize: { type: "integer" },
  },
};

function statusData(value: Awaited<ReturnType<typeof projectCacheStatus>>): JsonValue {
  return {
    artifactCount: value.artifactCount,
    keywordArtifactCount: value.keywordArtifactCount,
    semanticArtifactCount: value.semanticArtifactCount,
    progressArtifactCount: value.progressArtifactCount,
    artifactByteSize: value.artifactByteSize,
    vectorCount: value.vectorCount,
    vectorByteSize: value.vectorByteSize,
    catalogArtifactCount: value.catalogArtifactCount,
  };
}

function pruneData(value: Awaited<ReturnType<typeof pruneProjectCache>>): JsonValue {
  return {
    removedArtifactCount: value.removedArtifactCount,
    skippedArtifactCount: value.skippedArtifactCount,
    removedArtifactByteSize: value.removedArtifactByteSize,
    removedVectorByteSize: value.removedVectorByteSize,
  };
}

/** Cache commands remain local/read-only-or-explicit-cleanup and never start Backend/model work. */
export function createCacheCommands(): readonly CommandDefinition[] {
  return Object.freeze([
    {
      name: "cache.status",
      summary: "Report user-level derived query cache state without reading project sources.",
      positionals: [],
      options: [],
      resultSchema: cacheStatusSchema,
      errorCodes: frameworkErrorCodes,
      exitCodes: [0, 2],
      async handler(invocation) {
        const options = resolveProjectInvocationOptions(invocation.options);
        return { data: statusData(await projectCacheStatus(options.cacheRoot)) };
      },
    },
    {
      name: "cache.prune",
      summary:
        "Remove unused user-level derived query artifacts while preserving active operations.",
      positionals: [],
      options: [],
      resultSchema: cachePruneSchema,
      errorCodes: frameworkErrorCodes,
      exitCodes: [0, 2],
      async handler(invocation) {
        const options = resolveProjectInvocationOptions(invocation.options);
        return { data: pruneData(await pruneProjectCache(options.cacheRoot)) };
      },
    },
  ]);
}
