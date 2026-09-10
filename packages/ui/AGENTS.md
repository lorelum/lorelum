# AGENTS.md - packages/ui

The root instructions apply. This package owns reusable Web UI and production design tokens; it does not own routes, locale copy, data fetching, theme state, or page animation.

- Read the root `DESIGN.md` and `docs/plans/design-infrastructure.md` before changing public package exports or token roles.
- Use `bunx --bun shadcn@latest` from this directory. Check `info`, upstream docs, `add --dry-run`, and diffs before adding or updating an explicit `@shadcn` item.
- Keep `style`, base, icon library, and aliases aligned with `components.json`. Do not use Radix APIs in this Base UI package.
- Reuse semantic tokens and existing variants. Call-site `className` is for layout, not replacing component colors or typography.
- Do not add components speculatively or use `add --all`. A new component needs a real consumer and behavior-focused tests.
- Keep CSS values in `styles/tokens.css`; `theme.css` only maps them into Tailwind namespaces.
- Add colocated `bun:test` coverage. Run package typecheck/tests and the site production build after changing components or styles.
