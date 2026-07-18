import { z } from "zod";

import { PACK_NAME_REGEX, SEMVER_REGEX, AuthorSchema } from "./common";

/**
 * pack.yaml metadata. Mirrors §1.1 of the finalized spec — name/version
 * required, the rest optional. `depends_on` is reserved; v1 ignores it
 * (validate flags a non-empty value as a warning).
 */
export const PackSchema = z.object({
  name: z.string().regex(PACK_NAME_REGEX, "pack name must be kebab-case"),
  version: z.string().regex(SEMVER_REGEX, "version must be semver"),
  description: z.string().optional(),
  author: AuthorSchema.optional(),
  license: z.string().optional(),
  applies_to: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
});

export type Pack = z.infer<typeof PackSchema>;
