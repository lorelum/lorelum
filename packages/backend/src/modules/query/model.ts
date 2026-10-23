import { isAbsolute } from "node:path";
import { z } from "zod";

/** Wire shape only; controllers validate the method and Engine validates text/limit. */
export const queryModeSchema = z.enum(["semantic", "keyword"]);
export type QueryMode = z.infer<typeof queryModeSchema>;
const absolutePath = z.string().min(1).refine(isAbsolute, "path must be absolute");
export const projectSemanticRequestSchema = z
  .strictObject({
    projectRoot: absolutePath.optional(),
    startDirectory: absolutePath.optional(),
    cacheRoot: absolutePath,
  })
  .refine(
    (value) => value.projectRoot !== undefined || value.startDirectory !== undefined,
    "projectContext requires projectRoot or startDirectory",
  );
export type ProjectContextTargetRequest = z.infer<typeof projectSemanticRequestSchema>;
const queryRequestFields = {
  text: z.string(),
  limit: z.int().optional(),
  projectContext: projectSemanticRequestSchema.optional(),
  cacheRoot: absolutePath.optional(),
  maxWaitMs: z.int().nonnegative().max(120_000).optional(),
  minCoveragePercent: z.int().min(0).max(100).optional(),
};
export const queryRequestSchema = z
  .strictObject({
    // The store root must be explicit and absolute; the separator convention is the host's.
    storageRoot: z.string().min(1).refine(isAbsolute, "storageRoot must be an absolute path"),
    query: z.union([
      z.strictObject({
        ...queryRequestFields,
        mode: z.literal("semantic").optional(),
        retrievalMethod: z.unknown().optional(),
      }),
      z.strictObject({
        ...queryRequestFields,
        mode: z.literal("keyword"),
        retrievalMethod: z.unknown().optional(),
      }),
    ]),
  })
  .refine(
    (value) => value.query.projectContext === undefined || value.query.cacheRoot === undefined,
    "projectContext carries its cacheRoot",
  );
export type BackendQueryRequest = z.infer<typeof queryRequestSchema>;

export const queryHitSchema = z.strictObject({
  practiceId: z.string(),
  title: z.string(),
  stage: z.string(),
  techStack: z.array(z.string()),
  appliesWhen: z.string(),
  severity: z.enum(["info", "warn", "critical"]),
  contentDigest: z.string(),
});

export const keywordQueryResultSchema = z.strictObject({
  mode: z.literal("keyword"),
  emptyReason: z.literal("corpus-empty").optional(),
  results: z.array(queryHitSchema),
});
export const semanticQueryResultSchema = z.strictObject({
  mode: z.literal("semantic"),
  profileId: z.string().regex(/^[a-f0-9]{64}$/),
  coverage: z.enum(["complete", "partial"]),
  emptyReason: z.literal("corpus-empty").optional(),
  indexedPracticeCount: z.int().nonnegative().optional(),
  totalPracticeCount: z.int().nonnegative().optional(),
  operationId: z.string().uuid().optional(),
  context: z
    .strictObject({
      state: z.enum(["ready", "degraded"]),
      warnings: z.array(
        z.strictObject({
          code: z.enum(["config.invalid", "pack.invalid", "practice.invalid", "source.unsafe"]),
          layerDepth: z.int().nonnegative(),
          packName: z.string().optional(),
          practiceId: z.string().optional(),
        }),
      ),
    })
    .optional(),
  results: z.array(queryHitSchema),
});
export const semanticIndexingResultSchema = z.strictObject({
  state: z.literal("indexing"),
  operationId: z.string().uuid(),
  indexedPracticeCount: z.int().nonnegative(),
  totalPracticeCount: z.int().nonnegative(),
  context: z
    .strictObject({
      state: z.enum(["ready", "degraded"]),
      warnings: z.array(
        z.strictObject({
          code: z.enum(["config.invalid", "pack.invalid", "practice.invalid", "source.unsafe"]),
          layerDepth: z.int().nonnegative(),
          packName: z.string().optional(),
          practiceId: z.string().optional(),
        }),
      ),
    })
    .optional(),
});
export const semanticPreparingResultSchema = z.strictObject({
  state: z.literal("preparing"),
  preparationId: z.string().uuid(),
  context: z
    .strictObject({
      state: z.enum(["ready", "degraded"]),
      warnings: z.array(
        z.strictObject({
          code: z.enum(["config.invalid", "pack.invalid", "practice.invalid", "source.unsafe"]),
          layerDepth: z.int().nonnegative(),
          packName: z.string().optional(),
          practiceId: z.string().optional(),
        }),
      ),
    })
    .optional(),
});
export const queryResultSchema = z.union([
  keywordQueryResultSchema,
  semanticQueryResultSchema,
  semanticIndexingResultSchema,
  semanticPreparingResultSchema,
]);
export type BackendQueryResult = z.infer<typeof queryResultSchema>;
