import { describe, expect, test } from "bun:test";
import { dateTileParts } from "./date-tile";

describe("dateTileParts", () => {
  test("formats the English parts", () => {
    expect(dateTileParts("2026-09-18", "en")).toEqual({ day: "18", month: "Sep", year: "2026" });
  });

  test("formats the Chinese parts", () => {
    const parts = dateTileParts("2026-09-18", "zh");
    expect(parts.day).toBe("18");
    expect(parts.month).toBe("9月");
    expect(parts.year).toContain("2026");
  });

  test("keeps a zero-padded day", () => {
    expect(dateTileParts("2026-09-05", "en").day).toBe("05");
  });

  test("does not move across year edges with the runtime timezone", () => {
    expect(dateTileParts("2026-01-01", "en")).toEqual({ day: "01", month: "Jan", year: "2026" });
    expect(dateTileParts("2026-12-31", "en")).toEqual({ day: "31", month: "Dec", year: "2026" });
  });

  test("falls back to English for an unknown language", () => {
    expect(dateTileParts("2026-09-18", "fr").month).toBe("Sep");
  });
});
