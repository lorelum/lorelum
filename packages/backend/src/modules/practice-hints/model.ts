import { isAbsolute } from "node:path";
import { z } from "zod";

import { sessionRefSchema } from "../sessions/model";

export { shellToolEventSchema } from "../sessions/model";
export type { ShellToolEvent } from "../sessions/model";

const absolutePathSchema = z.string().min(1).max(4_096).refine(isAbsolute);

/** Metadata for a Practice that was successfully read; it is not adopted guidance. */
export const readHintSchema = z.strictObject({
  id: z.string().min(1).max(1_024),
  digest: z.string().min(1).max(256),
  title: z.string().min(1).max(4_096),
  appliesWhen: z.string().max(8_192).optional(),
});
export type ReadHint = z.infer<typeof readHintSchema>;

export const successfulGetReportSchema = z.strictObject({
  cwd: absolutePathSchema,
  hint: readHintSchema,
  session: sessionRefSchema.optional(),
});
export type SuccessfulGetReport = z.infer<typeof successfulGetReportSchema>;

export const readHintsQuerySchema = z.strictObject({ ...sessionRefSchema.shape });

export const persistedReadHintSchema = z.strictObject({
  ...sessionRefSchema.shape,
  cwd: absolutePathSchema,
  readAt: z.string().datetime(),
  hint: readHintSchema,
});
export type PersistedReadHint = z.infer<typeof persistedReadHintSchema>;

export const readHintsResponseSchema = z.array(readHintSchema);
export const practiceHintAckSchema = z.strictObject({ ok: z.literal(true) });
