---
name: lorelum
description: Use Lorelum's installed Knowledge Pack index to decide when to retrieve relevant engineering Practices. Do not query on every action; query only when the current task and work moment match an installed Pack.
---

# Lorelum

Lorelum is an optional local engineering-knowledge system for AI coding agents. It stores reusable engineering guidance as discrete, trigger-conditioned Practices inside Knowledge Packs.

## Progressive retrieval protocol

1. Treat the injected **Pack Index** as lightweight routing metadata, not as the full engineering rules.
2. Compare the current task and work moment with each Pack's description and `applies_to` values.
3. If no installed Pack is plausibly relevant, do not call Lorelum.
4. If a Pack is relevant, query once with both the task goal and the current moment, for example:

   ```text
   lore query "I am implementing a React settings page and deciding the API boundary before coding."
   ```

5. Use the compact query results to choose a relevant Practice. Retrieve the full Practice only when its concrete guidance is needed:

   ```text
   lore get <practice-id>
   ```

## Good query moments

Consider a targeted query when:

- defining scope or an implementation plan;
- entering a high-risk boundary such as auth, data, API, state, persistence, or migrations;
- changing an earlier requirement or architectural decision;
- preparing to claim completion;
- recovering after context compaction and needing to re-ground the task.

Do not turn Lorelum into a mandatory ceremony. Do not run a query before every file edit, shell command, tool call, or turn. The `SessionStart` and `PostCompact` hooks restore only the Pack Index; they do not automatically query Practices.
