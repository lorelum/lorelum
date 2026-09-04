/**
 * @lorelum/engine — Practice retrieval (embed + metadata + graph).
 *
 * P0 scaffold: only a presence marker. Retrieval, ranking, and the local
 * vector store land with the engine tasks.
 */

export const PACKAGE_NAME = "@lorelum/engine";

// LocalStore is the engine's first public capability (ADR 0007 §13); the
// vector layer and CLI/MCP consumers take their entry point from this
// boundary, never from package-internal directories.
export * from "./local-store";
export * from "./query";
export * from "./get";
