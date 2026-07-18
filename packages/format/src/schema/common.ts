import { z } from "zod";

/**
 * Practice / Decision / anti-pattern id: dotted name, at least two segments,
 * each segment `[a-z0-9]+(-[a-z0-9]+)*`. Matches `react.api.layered-design`;
 * rejects `React.x`, `react..api`, and a single segment like `react`.
 */
export const ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

/** Pack name: kebab-case, single segment allowed (`react-fullstack`). */
export const PACK_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Semver (zod has no built-in helper): x.y.z with optional prerelease/build. */
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export const SeverityEnum = z.enum(["info", "warn", "critical"]);

/** Pack author: free-form string or `{ name }`. Registry concern; local mode ignores. */
export const AuthorSchema = z.union([z.string(), z.object({ name: z.string() })]);
