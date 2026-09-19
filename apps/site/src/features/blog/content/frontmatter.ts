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
 */
export const blogFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  date: isoDate,
  category: z.enum(blogCategories),
  author: z.string().min(1),
  updated: isoDate.optional(),
  draft: z.boolean().default(false),
});

export type BlogFrontmatter = z.output<typeof blogFrontmatterSchema>;
