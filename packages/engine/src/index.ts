/**
 * @lorelum/engine — canonical LocalStore reads and keyword Practice retrieval.
 */

export const PACKAGE_NAME = "@lorelum/engine";

// LocalStore is the engine's first public capability (ADR 0007 §13); the
// vector layer and CLI/MCP consumers take their entry point from this
// boundary, never from package-internal directories.
export * from "./local-store";
export * from "./query";
export * from "./list";
