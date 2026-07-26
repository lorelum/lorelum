export type JsonSchema = {
  oneOf?: readonly JsonSchema[];
  type?: "array" | "boolean" | "integer" | "number" | "object" | "string";
  const?: unknown;
  enum?: readonly unknown[];
  additionalProperties?: boolean;
  required?: readonly string[];
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Readonly<Record<string, JsonSchema>>;
};

/** Validates the JSON Schema vocabulary used by the v1 protocol contract. */
export function validateProtocolSchema(value: unknown, schema: JsonSchema): string[] {
  return validateJsonSchema(value, schema);
}

/** Validate a command result or protocol envelope against the supported JSON Schema subset. */
export function validateJsonSchema(value: unknown, schema: JsonSchema): string[] {
  return validate(value, schema, "response");
}

function validate(value: unknown, schema: JsonSchema, path: string): string[] {
  if (schema.oneOf !== undefined) {
    const results = schema.oneOf.map((candidate) => validate(value, candidate, path));
    const matchingSchemas = results.filter((errors) => errors.length === 0);
    return matchingSchemas.length === 1
      ? []
      : [`${path} must match exactly one protocol response schema`];
  }

  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    return [`${path} must equal ${JSON.stringify(schema.const)}`];
  }

  if (schema.enum !== undefined && !schema.enum.some((candidate) => Object.is(value, candidate))) {
    return [
      `${path} must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(", ")}`,
    ];
  }

  if (schema.type === "string") {
    return typeof value === "string" ? [] : [`${path} must be a string`];
  }

  if (schema.type === "boolean") {
    return typeof value === "boolean" ? [] : [`${path} must be a boolean`];
  }

  if (schema.type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? []
      : [`${path} must be a finite number`];
  }

  if (schema.type === "integer") {
    return typeof value === "number" && Number.isInteger(value)
      ? []
      : [`${path} must be an integer`];
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    const errors: string[] = [];
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.items !== undefined) {
      errors.push(
        ...value.flatMap((item, index) => validate(item, schema.items!, `${path}[${index}]`)),
      );
    }
    return errors;
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
