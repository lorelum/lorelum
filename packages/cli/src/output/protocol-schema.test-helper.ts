import type { JsonSchema } from "./protocol.js";

/** Validates the JSON Schema vocabulary used by the v1 protocol contract. */
export function validateProtocolSchema(value: unknown, schema: JsonSchema): string[] {
  return validate(value, schema, "response");
}

/** Validates command data against the JSON Schema subset emitted by capability discovery. */
export function validateJsonSchema(value: unknown, schema: JsonSchema): string[] {
  return validate(value, schema, "data");
}

function validate(value: unknown, schema: JsonSchema, path: string): string[] {
  if (schema.oneOf !== undefined) {
    const results = schema.oneOf.map((candidate) => validate(value, candidate, path));
    const matchingSchemas = results.filter((errors) => errors.length === 0);
    return matchingSchemas.length === 1 ? [] : [`${path} must match exactly one schema branch`];
  }

  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    return [`${path} must equal ${JSON.stringify(schema.const)}`];
  }

  if (schema.enum !== undefined && !schema.enum.some((candidate) => Object.is(value, candidate))) {
    return [`${path} must be one of ${JSON.stringify(schema.enum)}`];
  }

  if (schema.type === "string") {
    return typeof value === "string" ? [] : [`${path} must be a string`];
  }

  if (schema.type === "boolean") {
    return typeof value === "boolean" ? [] : [`${path} must be a boolean`];
  }

  if (schema.type === "integer") {
    return Number.isInteger(value) ? [] : [`${path} must be an integer`];
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    return schema.items === undefined
      ? []
      : value.flatMap((item, index) => validate(item, schema.items!, `${path}[${index}]`));
  }

  if (schema.type !== "object") return [];
  if (!isRecord(value)) return [`${path} must be an object`];

  const errors: string[] = [];
  for (const property of schema.required ?? []) {
    if (!Object.hasOwn(value, property)) errors.push(`${path}.${property} is required`);
  }

  if (schema.additionalProperties === false) {
    for (const property of Object.keys(value)) {
      if (schema.properties?.[property] === undefined) {
        errors.push(`${path}.${property} is not allowed`);
      }
    }
  }

  for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(value, property)) {
      errors.push(...validate(value[property], propertySchema, `${path}.${property}`));
    }
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
