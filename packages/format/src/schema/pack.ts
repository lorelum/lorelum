import { z } from "zod";

import { PACK_NAME_REGEX, SEMVER_REGEX, AuthorSchema } from "./common";

/**
 * pack.yaml metadata. Mirrors §1.1 of the finalized spec — name/version
 * required, the rest optional. `depends_on` is reserved; v1 ignores it
 * (validate flags a non-empty value as a warning).
 */
export const PackSchema = z.object({
  name: z
    .string()
    .regex(PACK_NAME_REGEX, "pack name must be kebab-case")
    .describe("Stable pack id, e.g. react-fullstack. Key for search/reference/install."),
  version: z.string().regex(SEMVER_REGEX, "version must be semver").describe("Semver, e.g. 0.1.0."),
  description: z.string().optional().describe("One line, for lore search and humans."),
  author: AuthorSchema.optional(),
  license: z.string().optional().describe("SPDX; pack content is CC-BY-4.0."),
  applies_to: z
    .array(z.string())
    .optional()
    .describe("tech_stack list this pack covers; used for metadata filtering."),
  depends_on: z
    .array(z.string())
    .optional()
    .describe("Reserved — ignored in v1; a non-empty value is a warning."),
});

export type Pack = z.infer<typeof PackSchema>;
