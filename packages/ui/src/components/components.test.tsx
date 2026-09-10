import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "./badge";
import { Button, buttonVariants } from "./button";
import { Separator } from "./separator";

describe("shared UI components", () => {
  test("renders a semantic native button on the server", () => {
    const html = renderToStaticMarkup(<Button type="button">Run query</Button>);

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain("type-label");
    expect(html).toContain("text-primary-foreground");
    expect(html).toContain("Run query");
  });

  test("preserves Base UI render composition for links", () => {
    const html = renderToStaticMarkup(
      <Button render={<a href="/docs" />} nativeButton={false} variant="link">
        Documentation
      </Button>,
    );

    expect(html).toContain("<a");
    expect(html).toContain('href="/docs"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain('type="button"');
  });

  test("preserves Base UI's stateful className contract", () => {
    const html = renderToStaticMarkup(
      <Button className={(state) => (state.disabled ? "is-disabled" : "is-enabled")}>
        Callback
      </Button>,
    );

    expect(html).toContain("is-enabled");
    expect(html).toContain("type-label");
    expect(html).toContain("text-primary-foreground");
  });

  test("exposes explicit hover, pressed, focus and disabled states", () => {
    const classes = buttonVariants({ variant: "default" });

    expect(classes).toContain("hover:bg-primary-hover");
    expect(classes).toContain("active:bg-primary-pressed");
    expect(classes).toContain("focus-visible:ring-3");
    expect(classes).toContain("disabled:pointer-events-none");
  });

  test("assigns exactly one typography role to each button size", () => {
    const defaultClasses = buttonVariants({ size: "default" });
    const extraSmallClasses = buttonVariants({ size: "xs" });

    expect(defaultClasses).toContain("type-label");
    expect(defaultClasses).not.toContain("type-caption");
    expect(extraSmallClasses).toContain("type-caption");
    expect(extraSmallClasses).not.toContain("type-label");
  });

  test("renders badge and separator semantics on the server", () => {
    const badge = renderToStaticMarkup(<Badge>Indexed</Badge>);
    const separator = renderToStaticMarkup(
      <Separator
        orientation="vertical"
        className={(state) => (state.orientation === "vertical" ? "is-vertical" : undefined)}
      />,
    );

    expect(badge).toContain('data-slot="badge"');
    expect(badge).toContain("type-caption");
    expect(badge).toContain("bg-secondary");
    expect(badge).toContain("Indexed");
    expect(separator).toContain('role="separator"');
    expect(separator).toContain('aria-orientation="vertical"');
    expect(separator).toContain("is-vertical");
  });
});
