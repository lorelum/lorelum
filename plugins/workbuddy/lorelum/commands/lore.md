---
description: Retrieve relevant Lorelum engineering Practices for the current task or question.
argument-hint: "[question]"
skills: lorelum
---

Use the `lorelum` skill for this request:

$ARGUMENTS

When a question is provided, treat it as the retrieval focus: run one targeted natural-language `lore query` for it, then read the full body of every candidate Practice with `lore get <practice-id>`. Read default text directly; use `--json` only to diagnose an unexpected result or inspect protocol details.

When the command is invoked without arguments, evaluate the current task and retrieve the Practices that can inform its decisions, verification, or recovery using the same sequence. Reuse the SessionStart-injected Installed Pack Catalog as routing metadata instead of rerunning `lore pack list --details`.
