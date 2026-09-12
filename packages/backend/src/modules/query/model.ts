import { z } from "zod";

/** Wire contract for Backend query dispatch; Engine owns text and limit validation. */
export const queryModeSchema = z.enum(["semantic", "keyword"]);
export type QueryMode = z.infer<typeof queryModeSchema>;
export const queryRequestSchema = z.strictObject({
  storageRoot: z.string().min(1).regex(/^\//),
  query: z.strictObject({
    text: z.string(),
    limit: z.int().optional(),
    mode: queryModeSchema.optional(),
  }),
});
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
  results: z.array(queryHitSchema),
});
export const queryResultSchema = z.discriminatedUnion("mode", [
  keywordQueryResultSchema,
  semanticQueryResultSchema,
]);
export type BackendQueryResult = z.infer<typeof queryResultSchema>;
