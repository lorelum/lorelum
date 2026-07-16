#!/usr/bin/env bun
/**
 * lore — the Lorelum CLI entry point.
 *
 * P0 scaffold: a stub that confirms the binary runs. Subcommands
 * (install/query/decide/check/learn) land with their owning tasks.
 */

export const PACKAGE_NAME = "@lorelum/cli";

if (import.meta.main) {
  console.log("lore — Lorelum CLI (scaffold)");
}
