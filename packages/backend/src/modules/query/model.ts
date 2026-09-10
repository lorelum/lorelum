import { z } from "zod";

/**
 * Wire contract for the Engine keyword-query facade.  Query text and limit
 * remain intentionally broad here: QueryService owns their domain validation.
 */
export const queryRequestSchema = z.strictObject({
  storageRoot: z.string().min(1).regex(/^\//),
  query: z.strictObject({
    text: z.string(),
    limit: z.int().optional(),
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

export const queryResultSchema = z.strictObject({
  mode: z.literal("keyword"),
  results: z.array(queryHitSchema),
});
export type BackendQueryResult = z.infer<typeof queryResultSchema>;
