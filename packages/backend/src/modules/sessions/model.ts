import { isAbsolute } from "node:path";
import { z } from "zod";

export const hostKeySchema = z.enum(["codex", "cursor", "workbuddy", "zcode"]);
export type HostKey = z.infer<typeof hostKeySchema>;

const sessionIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      Buffer.byteLength(value, "utf8") <= 120 &&
      Buffer.from(value, "utf8").toString("utf8") === value &&
      value !== "." &&
      value !== ".." &&
      !/[\\/]/.test(value) &&
      !value.includes("\0"),
    "sessionId must be valid UTF-8, at most 120 bytes, and a single path component",
  );

export const sessionRefSchema = z.strictObject({
  hostKey: hostKeySchema,
  sessionId: sessionIdSchema,
});
export type SessionRef = z.infer<typeof sessionRefSchema>;

const absolutePathSchema = z.string().min(1).max(4_096).refine(isAbsolute);

/** Host-neutral Hook input. Only shell tools establish Backend activity windows. */
export const shellToolEventSchema = z.strictObject({
  hostKey: hostKeySchema,
  event: z.enum(["pre", "post"]),
  toolKind: z.enum(["shell", "other"]),
  sessionId: sessionIdSchema,
  toolUseId: z.string().min(1).max(256),
  cwd: absolutePathSchema,
});
export type ShellToolEvent = z.infer<typeof shellToolEventSchema>;
