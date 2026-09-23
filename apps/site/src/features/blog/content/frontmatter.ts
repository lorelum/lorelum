import { z } from "zod";

/** Categories mirror the blog's evidence sources: benchmark runs, Pack work, other engineering. */
export const blogCategories = ["benchmark", "packs", "lorelum"] as const;
export type BlogCategory = (typeof blogCategories)[number];

/** A `YYYY-MM-DD` string that also has to parse as a real calendar date. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be formatted as YYYY-MM-DD")
  .refine((value) => {
    // `Date.parse` accepts rolled-over dates like 2026-02-30 on some engines,
    // so the components are checked against the parsed UTC date instead.
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "date must be a real calendar date");

/**
 * Frontmatter contract for blog posts. The description doubles as the
 * list-page summary, so it stays a plain factual sentence — no positioning copy.
 *
 * `image` is the index card's cover art, as a site-public path (`/…`) served by
 * the app itself. It is optional, and deliberately not a URL: the card renders
 * it next to the post's own title, so a remote hop would make the index depend
 * on a third party for its own layout. A post without one gets a generated
 * cover, so the field is an upgrade, never a requirement.
 *
 * `updated` is a provenance signal, so a value earlier than `date` is a mistake:
 * it would claim the post was revised before it was written. The comparison is a
 * plain string compare, which is chronological for the `YYYY-MM-DD` shape both
 * dates are already constrained to.
 */
export const blogFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    date: isoDate,
    category: z.enum(blogCategories),
    author: z.string().min(1),
    image: z
      .string()
      // A lookahead keeps the second character from being a slash, so
      // protocol-relative URLs (`//cdn…`) are rejected alongside bare words.
      .regex(/^\/(?!\/)[^\s?#]*[^/\s?#]$/, "image must be a site-public path like /blog/covers/art.svg")
      .optional(),
    updated: isoDate.optional(),
    draft: z.boolean().default(false),
  })
  .refine((value) => value.updated === undefined || value.updated >= value.date, {
    message: "updated must not be earlier than date",
    path: ["updated"],
  });

export type BlogFrontmatter = z.output<typeof blogFrontmatterSchema>;
