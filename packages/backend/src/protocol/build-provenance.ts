import { z } from "zod";

export const BuildProvenanceSchema = z.strictObject({
  toolVersion: z.string(),
  revision: z.string().nullable(),
  dirty: z.boolean().nullable(),
  buildKind: z.enum(["compiled", "source"]),
});
export type BuildProvenance = z.infer<typeof BuildProvenanceSchema>;

export type BuildInfo = BuildProvenance & Readonly<{ buildIdentity: string }>;
