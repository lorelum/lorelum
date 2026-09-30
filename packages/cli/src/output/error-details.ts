import type { JsonSchema, JsonValue } from "./protocol.js";

/** Categories of structured diagnostic facts a public failure may expose. */
export const errorDetailKinds = ["usage", "configuration"] as const;
export type ErrorDetailKind = (typeof errorDetailKinds)[number];

/** Stable sources that owning validators may identify. */
export const errorDetailSourceKinds = [
  "command-line",
  "config-file",
  "environment-variable",
] as const;
export type ErrorDetailSourceKind = (typeof errorDetailSourceKinds)[number];

/** Small, stable reason vocabulary owned by this public contract. */
export const errorDetailReasons = [
  "missing",
  "conflicting-options",
  "unknown-option",
  "unknown-command",
  "read-failed",
  "yaml-syntax",
  "invalid-shape",
  "unknown-field",
  "invalid-type",
  "invalid-value",
  "out-of-range",
] as const;
export type ErrorDetailReason = (typeof errorDetailReasons)[number];

export type ErrorDetailExpected =
  | { readonly kind: "integer-range"; readonly min: number; readonly max: number }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | {
      readonly kind: "type";
      readonly name: "integer" | "string" | "boolean" | "object";
    }
  | { readonly kind: "format"; readonly format: "absolute-path" | "https-url" };

export interface ErrorDetailSource {
  readonly kind: ErrorDetailSourceKind;
  readonly name?: string;
}

export interface ErrorDetailLocation {
  readonly line: number;
  readonly column: number;
}

export interface ErrorDetail {
  readonly kind: ErrorDetailKind;
  readonly subject: string;
  readonly reason: ErrorDetailReason;
  readonly source?: ErrorDetailSource;
  readonly received?: string;
  readonly expected?: ErrorDetailExpected;
  readonly hint?: string;
  readonly location?: ErrorDetailLocation;
}

/** Public output budgets; every detail is defensively constrained at the envelope edge. */
export const errorDetailBudgets = Object.freeze({
  maxDetails: 5,
  subjectMaxLength: 120,
  receivedMaxLength: 160,
  hintMaxLength: 200,
  enumValuesMax: 16,
  enumValueMaxLength: 64,
  nameMaxLength: 120,
});

/**
 * Constrains a producer-owned detail. This helper does not decide whether a
 * value is safe to echo; that decision belongs to the owning validator.
 */
export function createErrorDetail(input: ErrorDetail): ErrorDetail {
  return Object.freeze({
    kind: input.kind,
    subject: constrainText(input.subject, errorDetailBudgets.subjectMaxLength),
    reason: input.reason,
    ...(input.source === undefined ? {} : { source: constrainSource(input.source) }),
    ...(input.received === undefined
      ? {}
      : { received: constrainText(input.received, errorDetailBudgets.receivedMaxLength) }),
    ...(input.expected === undefined ? {} : { expected: constrainExpected(input.expected) }),
    ...(input.hint === undefined
      ? {}
      : { hint: constrainText(input.hint, errorDetailBudgets.hintMaxLength) }),
    ...(input.location === undefined ? {} : { location: input.location }),
  });
}

/** Drops anything not safely representable by the public contract. */
export function sanitizeErrorDetails(
  details: readonly unknown[],
): readonly ErrorDetail[] | undefined {
  const constrained: ErrorDetail[] = [];
  for (const candidate of details.slice(0, errorDetailBudgets.maxDetails)) {
    const detail = sanitizeErrorDetail(candidate);
    if (detail !== undefined) constrained.push(detail);
  }
  return constrained.length === 0 ? undefined : Object.freeze(constrained);
}

/** Renders the same structured facts as one safe terminal line. */
export function formatErrorDetail(detail: ErrorDetail): string {
  const source =
    detail.source === undefined
      ? ""
      : detail.source.kind === "environment-variable" && detail.source.name !== undefined
        ? ` from ${escapeTerminalControls(detail.source.name)}`
        : ` from ${detail.source.kind}`;
  const location =
    detail.location === undefined
      ? ""
      : ` at line ${detail.location.line}, column ${detail.location.column}`;
  const expected = detail.expected === undefined ? "" : ` ${expectedClause(detail.expected)}`;
  const core = `${escapeTerminalControls(detail.subject)}${source}${location}${expected}`;
  const rejected =
    core.length === 0
      ? "A configuration value was rejected"
      : `${core} was rejected (${detail.reason})`;
  const received =
    detail.received === undefined ? "" : ` (received: ${escapeTerminalControls(detail.received)})`;
  const statement = `${rejected}${received}.`;
  return detail.hint === undefined
    ? statement
    : `${statement} ${escapeTerminalControls(detail.hint)}`;
}

export const errorDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "subject", "reason"],
  properties: {
    kind: { enum: [...errorDetailKinds] },
    subject: { type: "string", minLength: 1, maxLength: errorDetailBudgets.subjectMaxLength },
    reason: { enum: [...errorDetailReasons] },
    source: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "command-line" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "config-file" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "name"],
          properties: {
            kind: { const: "environment-variable" },
            name: {
              type: "string",
              minLength: 1,
              maxLength: errorDetailBudgets.nameMaxLength,
            },
          },
        },
      ],
    },
    received: {
      type: "string",
      maxLength: errorDetailBudgets.receivedMaxLength,
    },
    expected: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "min", "max"],
          properties: {
            kind: { const: "integer-range" },
            min: { type: "integer" },
            max: { type: "integer" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "values"],
          properties: {
            kind: { const: "enum" },
            values: {
              type: "array",
              minItems: 1,
              maxItems: errorDetailBudgets.enumValuesMax,
              items: {
                type: "string",
                minLength: 1,
                maxLength: errorDetailBudgets.enumValueMaxLength,
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "name"],
          properties: {
            kind: { const: "type" },
            name: { enum: ["integer", "string", "boolean", "object"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "format"],
          properties: {
            kind: { const: "format" },
            format: { enum: ["absolute-path", "https-url"] },
          },
        },
      ],
    },
    hint: { type: "string", maxLength: errorDetailBudgets.hintMaxLength },
    location: {
      type: "object",
      additionalProperties: false,
      required: ["line", "column"],
      properties: {
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
      },
    },
  },
} as const satisfies JsonSchema;

function sanitizeErrorDetail(value: unknown): ErrorDetail | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Partial<ErrorDetail>;
  if (
    !errorDetailKinds.includes(input.kind as never) ||
    !errorDetailReasons.includes(input.reason as never) ||
    typeof input.subject !== "string" ||
    input.subject.length === 0
  ) {
    return undefined;
  }
  const source = input.source === undefined ? undefined : sanitizeSource(input.source);
  if (input.source !== undefined && source === undefined) return undefined;
  const received =
    input.received === undefined
      ? undefined
      : typeof input.received === "string"
        ? constrainText(input.received, errorDetailBudgets.receivedMaxLength)
        : undefined;
  if (input.received !== undefined && received === undefined) return undefined;
  const expected = input.expected === undefined ? undefined : sanitizeExpected(input.expected);
  if (input.expected !== undefined && expected === undefined) return undefined;
  const hint =
    input.hint === undefined
      ? undefined
      : typeof input.hint === "string"
        ? constrainText(input.hint, errorDetailBudgets.hintMaxLength)
        : undefined;
  if (input.hint !== undefined && hint === undefined) return undefined;
  const location =
    input.location === undefined
      ? undefined
      : typeof input.location === "object" &&
          input.location !== null &&
          Number.isSafeInteger(input.location.line) &&
          Number.isSafeInteger(input.location.column) &&
          input.location.line >= 1 &&
          input.location.column >= 1
        ? { line: input.location.line, column: input.location.column }
        : undefined;
  if (input.location !== undefined && location === undefined) return undefined;
  const detail = createErrorDetail({
    kind: input.kind!,
    subject: input.subject,
    reason: input.reason!,
    ...(source === undefined ? {} : { source }),
    ...(received === undefined ? {} : { received }),
    ...(expected === undefined ? {} : { expected }),
    ...(hint === undefined ? {} : { hint }),
    ...(location === undefined ? {} : { location }),
  });
  return isJsonValue(detail) ? detail : undefined;
}

function sanitizeSource(value: ErrorDetail["source"]): ErrorDetailSource | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as unknown as Record<string, unknown>;
  const keys = Object.keys(source);
  const kind = source.kind;
  if (kind === "command-line" || kind === "config-file") {
    return keys.length === 1 ? { kind } : undefined;
  }
  if (kind !== "environment-variable") return undefined;
  if (keys.length !== 2 || !keys.includes("name")) return undefined;
  if (typeof source.name !== "string" || source.name.length === 0) return undefined;
  return {
    kind,
    name: constrainText(source.name, errorDetailBudgets.nameMaxLength),
  };
}

function sanitizeExpected(value: unknown): ErrorDetailExpected | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const expected = value as Partial<ErrorDetailExpected>;
  if (expected.kind === "integer-range") {
    if (
      !Number.isSafeInteger(expected.min) ||
      !Number.isSafeInteger(expected.max) ||
      (expected.min as number) > (expected.max as number)
    ) {
      return undefined;
    }
    return { kind: "integer-range", min: expected.min!, max: expected.max! };
  }
  if (expected.kind === "enum") {
    if (!Array.isArray(expected.values)) return undefined;
    const values = expected.values
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(0, errorDetailBudgets.enumValuesMax)
      .map((item) => constrainText(item, errorDetailBudgets.enumValueMaxLength));
    return values.length === 0 ? undefined : { kind: "enum", values };
  }
  if (expected.kind === "type") {
    return ["integer", "string", "boolean", "object"].includes(expected.name as never)
      ? { kind: "type", name: expected.name! }
      : undefined;
  }
  if (expected.kind === "format") {
    return ["absolute-path", "https-url"].includes(expected.format as never)
      ? { kind: "format", format: expected.format! }
      : undefined;
  }
  return undefined;
}

function constrainSource(source: ErrorDetailSource): ErrorDetailSource {
  if (source.kind !== "environment-variable") return Object.freeze({ kind: source.kind });
  return Object.freeze({
    kind: "environment-variable",
    name: constrainText(source.name ?? "", errorDetailBudgets.nameMaxLength) as NonNullable<
      ErrorDetailSource["name"]
    >,
  });
}

function constrainExpected(expected: ErrorDetailExpected): ErrorDetailExpected {
  switch (expected.kind) {
    case "integer-range": {
      if (
        !Number.isSafeInteger(expected.min) ||
        !Number.isSafeInteger(expected.max) ||
        expected.min > expected.max
      ) {
        throw new TypeError("Integer-range expectations need safe, ordered bounds.");
      }
      return Object.freeze({ kind: "integer-range", min: expected.min, max: expected.max });
    }
    case "enum": {
      const values = expected.values
        .filter((value) => value.length > 0)
        .slice(0, errorDetailBudgets.enumValuesMax)
        .map((value) => constrainText(value, errorDetailBudgets.enumValueMaxLength));
      if (values.length === 0) throw new TypeError("Enum expectations need at least one value.");
      return Object.freeze({ kind: "enum", values: Object.freeze(values) });
    }
    case "type":
      return Object.freeze({ kind: "type", name: expected.name });
    case "format":
      return Object.freeze({ kind: "format", format: expected.format });
  }
}

function expectedClause(expected: ErrorDetailExpected): string {
  switch (expected.kind) {
    case "enum":
      return `must be one of: ${expected.values.map(escapeTerminalControls).join(", ")}`;
    case "integer-range":
      return `must be an integer from ${expected.min} through ${expected.max}`;
    case "type":
      return `must be of type ${expected.name}`;
    case "format":
      return expected.format === "absolute-path"
        ? "must be an absolute path"
        : "must be an HTTPS URL without credentials or a fragment";
  }
}

function constrainText(value: string, maxLength: number): string {
  const codePoints = [...value];
  const escaped = escapeTerminalControls(value);
  if (codePoints.length <= maxLength && escaped.length <= maxLength) return escaped;

  let visible = "";
  for (const codePoint of codePoints.slice(0, maxLength - 3)) {
    const segment = escapeTerminalControls(codePoint);
    if (visible.length + segment.length > maxLength) break;
    visible += segment;
  }
  return `${visible}...`;
}

function escapeTerminalControls(value: string): string {
  let visible = "";
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const unsafe =
      point <= 0x1f ||
      (point >= 0x7f && point <= 0x9f) ||
      (point >= 0x2028 && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069);
    visible += unsafe ? `\\u${point.toString(16).padStart(4, "0")}` : character;
  }
  return visible;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object") return false;
  const visited = new Set<unknown>();
  return isJsonSafe(value, visited);
}

function isJsonSafe(value: Readonly<object>, visited: Set<unknown>): boolean {
  if (visited.has(value)) return false;
  visited.add(value);
  try {
    for (const nested of Object.values(value)) {
      if (
        nested === null ||
        typeof nested === "string" ||
        typeof nested === "boolean" ||
        (typeof nested === "number" && Number.isFinite(nested))
      ) {
        continue;
      }
      if (typeof nested !== "object" || !isJsonSafe(nested as Readonly<object>, visited)) {
        return false;
      }
    }
    return true;
  } finally {
    visited.delete(value);
  }
}
