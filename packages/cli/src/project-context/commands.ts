import { initializeProjectConfig, ProjectConfigError } from "@lorelum/config";
import { InvalidProjectRootError, type StorageRoot } from "@lorelum/engine";

import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import { frameworkErrorCodes, invalidInvocationError } from "../runtime/errors";
import { resolveInvocationStorageRoot } from "../store/storage-root";
import { resolveProjectInvocationOptions, type ProjectContextResolver } from "./service";

const initResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["created"],
  properties: { created: { type: "boolean" } },
};

const statusResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["state"],
      properties: { state: { const: "none" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "state",
        "projectRootId",
        "layers",
        "base",
        "practiceCount",
        "sources",
        "warnings",
      ],
      properties: {
        state: { enum: ["ready", "degraded"] },
        projectRootId: { type: "string" },
        layers: { type: "array", items: { type: "integer" } },
        base: { enum: ["user", "none"] },
        practiceCount: { type: "integer" },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["scope", "status", "packName"],
            properties: {
              scope: { enum: ["project", "store"] },
              status: { enum: ["active", "shadowed", "ignored"] },
              layerDepth: { type: "integer" },
              packName: { type: "string" },
              practiceId: { type: "string" },
            },
          },
        },
        warnings: { type: "array", items: { type: "object" } },
      },
    },
  ],
};

export interface ProjectContextCommandServices {
  readonly storageRoot: StorageRoot;
  readonly resolveProjectContext: ProjectContextResolver;
}

function statusData(snapshot: Awaited<ReturnType<ProjectContextResolver>>): JsonValue {
  if (snapshot === undefined) return { state: "none" };
  return {
    state: snapshot.state,
    projectRootId: snapshot.projectRootId,
    layers: snapshot.layers.map((layer) => layer.depth),
    base: snapshot.effectiveConfig.base,
    practiceCount: snapshot.practices.length,
    sources: snapshot.sources.map((source) => ({
      scope: source.scope,
      status: source.status,
      packName: source.packName,
      ...(source.layerDepth === undefined ? {} : { layerDepth: source.layerDepth }),
      ...(source.practiceId === undefined ? {} : { practiceId: source.practiceId }),
    })),
    warnings: snapshot.warnings.map((warning) => ({
      code: warning.code,
      layerDepth: warning.layerDepth,
      ...(warning.packName === undefined ? {} : { packName: warning.packName }),
      ...(warning.practiceId === undefined ? {} : { practiceId: warning.practiceId }),
    })),
  };
}

export function createProjectContextCommands(
  services: ProjectContextCommandServices,
): readonly CommandDefinition[] {
  return Object.freeze([
    {
      name: "init",
      summary: "Create an editable .lorelum/config.yaml in the current directory once.",
      positionals: [],
      options: [],
      resultSchema: initResultSchema,
      errorCodes: frameworkErrorCodes,
      exitCodes: [0, 2],
      async handler() {
        try {
          const result = await initializeProjectConfig(process.cwd());
          return { data: { created: result.created } };
        } catch (error) {
          if (error instanceof ProjectConfigError) throw invalidInvocationError();
          throw error;
        }
      },
    },
    {
      name: "context.status",
      summary: "Show the active ProjectContext without exposing source paths or Practice bodies.",
      positionals: [],
      options: [],
      resultSchema: statusResultSchema,
      errorCodes: frameworkErrorCodes,
      exitCodes: [0, 2],
      async handler(invocation) {
        try {
          const root = resolveInvocationStorageRoot(
            invocation.options.storeRoot,
            services.storageRoot,
          );
          const snapshot = await services.resolveProjectContext(
            root,
            resolveProjectInvocationOptions(invocation.options),
          );
          return { data: statusData(snapshot) };
        } catch (error) {
          if (error instanceof InvalidProjectRootError) throw invalidInvocationError();
          throw error;
        }
      },
    },
  ]);
}
