import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./blog-search-dialog.tsx", import.meta.url), "utf8");

describe("blog search dialog composition", () => {
  test("owns an isolated handle and closes back to its named trigger", () => {
    expect(source).toContain("useState(createDialogHandle)");
    expect(source).toContain("dialogHandle={dialogHandle}");
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain("finalFocus={trigger}");
  });

  test("uses only blog results and the entry's own locale", () => {
    expect(source).toContain("blogDialogResults(posts, search, category, sort)");
    expect(source).toContain("url: blogPostPath(entry.locale, entry.slug)");
    expect(source).toContain("entry?.data.title");
    expect(source).toContain("entry?.data.description");
    expect(source).not.toContain("useDocsSearch");
    expect(source).not.toContain("hotKey");
  });

  test("portals the full-screen backdrop outside the query container after mounting", () => {
    expect(source).toContain("useState<HTMLElement | null>(null)");
    expect(source).toContain("useEffect(() => {\n    setPortalContainer(document.body);\n  }, [])");
    expect(source).toContain(
      "createPortal(<SearchDialogOverlay data-blog-search-overlay />, portalContainer)",
    );
  });

  test("restores applied q and limits draft input without changing the route per keystroke", () => {
    expect(source).toContain('setSearch(q ?? "")');
    expect(source).toContain("onSearchChange={setSearch}");
    expect(source).toContain("maxLength={200}");
    expect(source).toContain("}, [category, sort, q])");
    expect(source).toContain("t.blogNoSearchResults");
  });

  test("can apply the query as GET while preserving filters and isolating footer Enter", () => {
    expect(source).toContain('form="blog-search-form"');
    expect(source).toContain('role="search"');
    expect(source).toContain('method="get"');
    expect(source).toContain('name="sort" value={sort}');
    expect(source).toContain('name="category" value={category}');
    expect(source).toContain("search: { category, sort, q: parseBlogQuery(search) }");
    expect(source).toContain('if (event.key === "Enter")');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("event.currentTarget.requestSubmit()");
    expect(source).toContain("onKeyDownCapture=");
  });

  test("distinguishes an idle draft from a nonmatching search", () => {
    expect(source).toContain("const hasQuery = parseBlogQuery(search) !== undefined;");
    expect(source).toContain("hasQuery ? t.blogNoSearchResults : t.blogSearchStart");
  });
});
