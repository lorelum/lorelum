import { z } from "zod";

import { PACK_NAME_REGEX, SEMVER_REGEX } from "./common";

export const REGISTRY_SCHEMA_VERSION = 1 as const;

const SourcePathSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
    "path must be a safe repository-relative path",
  );

const GitRefSchema = z
  .string()
  .regex(/^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]*$/, "ref is unsafe")
  .refine(
    (ref) =>
      !ref.endsWith(".") &&
      !ref.endsWith("/") &&
      ref
        .split("/")
        .every(
          (segment) => segment.length > 0 && !segment.startsWith(".") && !segment.endsWith(".lock"),
        ),
    "ref is unsafe",
  );

export const RegistryReleaseSchema = z
  .object({
    version: z.string().regex(SEMVER_REGEX, "version must be semver"),
    ref: GitRefSchema,
    path: SourcePathSchema,
  })
  .strict();

export const RegistryPackSchema = z
  .object({
    name: z.string().regex(PACK_NAME_REGEX, "pack name must be kebab-case"),
    description: z.string().min(1).optional(),
    releases: z.array(RegistryReleaseSchema).min(1).max(128),
  })
  .strict()
  .superRefine((pack, context) => {
    const precedences = new Set<string>();
    for (const [index, release] of pack.releases.entries()) {
      const precedence = release.version.split("+", 1)[0]!;
      if (precedences.has(precedence)) {
        context.addIssue({
          code: "custom",
          path: ["releases", index, "version"],
          message: `release version "${release.version}" has duplicate semver precedence`,
        });
      }
      precedences.add(precedence);
    }
  });

/** Repository catalog descriptor consumed by `lore install`. */
export const RegistrySchema = z
  .object({
    schema_version: z.literal(REGISTRY_SCHEMA_VERSION),
    name: z.string().regex(PACK_NAME_REGEX, "registry name must be kebab-case"),
    description: z.string().min(1).optional(),
    packs: z.array(RegistryPackSchema).max(256),
  })
  .strict()
  .superRefine((registry, context) => {
    const names = new Set<string>();
    for (const [index, pack] of registry.packs.entries()) {
      if (names.has(pack.name)) {
        context.addIssue({
          code: "custom",
          path: ["packs", index, "name"],
          message: `duplicate pack name "${pack.name}"`,
        });
      }
      names.add(pack.name);
    }
  });

export type Registry = z.infer<typeof RegistrySchema>;
export type RegistryPack = z.infer<typeof RegistryPackSchema>;
export type RegistryRelease = z.infer<typeof RegistryReleaseSchema>;
