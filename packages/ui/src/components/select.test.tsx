import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Select } from "./select";
import { createDialogHandle } from "../lib/dialog-handle";

const options = [{ value: "newest", label: "最新" }, { value: "oldest", label: "最早" }] as const;

describe("shared select", () => {
  test("renders a named, collapsed combobox on the server", () => {
    const html = renderToStaticMarkup(<Select options={options} value="newest" label="排序" onValueChange={() => {}} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="排序"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="listbox"');
  });

  test("shows the selected label rather than a raw value or every option", () => {
    const html = renderToStaticMarkup(<Select options={options} value="oldest" label="排序" onValueChange={() => {}} />);
    expect(html).toContain("最早");
    expect(html).not.toContain("最新");
    expect(html).not.toContain('role="option"');
  });

  test("keeps system-owned radius, touch, focus and expanded state", () => {
    const html = renderToStaticMarkup(<Select options={options} value="newest" label="排序" onValueChange={() => {}} />);
    expect(html).toContain("rounded-[var(--radius)]");
    expect(html).not.toContain("rounded-full");
    expect(html).toContain("min-h-[var(--lore-size-touch)]");
    expect(html).toContain("focus-visible:outline-[var(--ring)]");
    expect(html).toContain("aria-expanded:bg-[var(--accent)]");
  });

  test("can name a committed value absent from the currently offered options", () => {
    const html = renderToStaticMarkup(<Select options={options} value="other" valueLabel="Other ordering" label="排序" onValueChange={() => {}} />);
    expect(html).toContain("Other ordering");
    expect(html).not.toContain('role="option"');
  });

  test("accepts identity and layout without inventing routes or locale state", () => {
    const html = renderToStaticMarkup(<Select id="sort" className="w-full" options={options} value="newest" label="排序" onValueChange={() => {}} />);
    expect(html).toContain('id="sort"');
    expect(html).toContain("w-full");
    expect(html).not.toContain("href=");
  });

  test("composes the Base UI portal, list and selected indicator", () => {
    const source = readFileSync(new URL("./select.tsx", import.meta.url), "utf8");
    for (const part of ["Portal", "Positioner", "Popup", "List", "Item", "ItemText", "ItemIndicator"]) {
      expect(source).toContain(`<SelectPrimitive.${part}`);
    }
    expect(source).toContain("alignItemWithTrigger={false}");
    expect(source).toContain("data-highlighted:bg-[var(--accent)]");
  });

  test("creates isolated dialog handles without opening a dialog during SSR", () => {
    const first = createDialogHandle();
    const second = createDialogHandle();
    expect(first).not.toBe(second);
    expect(first.isOpen).toBe(false);
    expect(second.isOpen).toBe(false);
  });
});
