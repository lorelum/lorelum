/**
 * @lorelum/shared — cross-package primitives shared by every other package.
 *
 * P0 scaffold: only a presence marker so cross-package imports resolve.
 * Real types (Practice id, PackHandle, errors) land with their owning tasks.
 */

export const PACKAGE_NAME = "@lorelum/shared";

/** JSON Schema subset used for protocol result metadata (single source). */
export type JsonSchema = {
  oneOf?: readonly JsonSchema[];
  type?: "array" | "boolean" | "integer" | "object" | "string";
  const?: unknown;
  enum?: readonly unknown[];
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Readonly<Record<string, JsonSchema>>;
  items?: JsonSchema;
};
