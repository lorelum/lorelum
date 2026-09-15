import { isAbsolute } from "node:path";
import { z } from "zod";

/** Wire contract for Backend query dispatch; Engine owns text and limit validation. */
export const queryModeSchema = z.enum(["semantic", "keyword"]);
export type QueryMode = z.infer<typeof queryModeSchema>;
const absolutePath = z.string().min(1).refine(isAbsolute, "path must be absolute");
export const projectSemanticRequestSchema = z.strictObject({
  projectRoot: absolutePath,
  cacheRoot: absolutePath,
});
export type ProjectSemanticRequest = z.infer<typeof projectSemanticRequestSchema>;
export const queryRequestSchema = z
  .strictObject({
    // The store root must be explicit and absolute; the separator convention is the host's.
    storageRoot: z.string().min(1).refine(isAbsolute, "storageRoot must be an absolute path"),
    query: z.strictObject({
      text: z.string(),
      limit: z.int().optional(),
      mode: queryModeSchema.optional(),
      projectContext: projectSemanticRequestSchema.optional(),
      cacheRoot: absolutePath.optional(),
      maxWaitMs: z.int().nonnegative().max(120_000).optional(),
      minCoveragePercent: z.int().min(0).max(100).optional(),
    }),
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
  results: z.array(queryHitSchema),
});
export const semanticQueryResultSchema = z.strictObject({
  mode: z.literal("semantic"),
  profileId: z.string().regex(/^[a-f0-9]{64}$/),
  coverage: z.enum(["complete", "partial"]),
  indexedPracticeCount: z.int().nonnegative().optional(),
  totalPracticeCount: z.int().nonnegative().optional(),
  operationId: z.string().uuid().optional(),
  results: z.array(queryHitSchema),
});
export const semanticIndexingResultSchema = z.strictObject({
  state: z.literal("indexing"),
  operationId: z.string().uuid(),
  indexedPracticeCount: z.int().nonnegative(),
  totalPracticeCount: z.int().nonnegative(),
});
export const semanticPreparingResultSchema = z.strictObject({
  state: z.literal("preparing"),
  preparationId: z.string().uuid(),
});
export const queryResultSchema = z.union([
  keywordQueryResultSchema,
  semanticQueryResultSchema,
  semanticIndexingResultSchema,
  semanticPreparingResultSchema,
]);
export type BackendQueryResult = z.infer<typeof queryResultSchema>;
