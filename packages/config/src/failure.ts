export type ConfigSource =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "environment"; readonly variable: string }
  | { readonly kind: "override"; readonly label: string }
  | { readonly kind: "resolved"; readonly label: string };

export type ConfigRule =
  | { readonly kind: "integer"; readonly minimum: number; readonly maximum: number }
  | { readonly kind: "positive-decimal-integer-without-leading-zeros" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "shape"; readonly expected: "object" | "boolean" | "string" }
  | { readonly kind: "non-empty-absolute-path" }
  | { readonly kind: "https-url-without-credentials-or-fragment" }
  | { readonly kind: "max-bytes"; readonly maximum: number };

export type ConfigFailure =
  | {
      readonly kind: "document";
      readonly source: Extract<ConfigSource, { readonly kind: "file" }>;
      readonly reason: "yaml-syntax";
      readonly location?: { readonly line: number; readonly column: number };
    }
  | {
      readonly kind: "document";
      readonly source: Extract<ConfigSource, { readonly kind: "file" }>;
      readonly reason: "unreadable" | "not-file" | "too-large" | "root-shape";
    }
  | {
      readonly kind: "setting";
      readonly source: ConfigSource;
      readonly subject: string;
      readonly reason: "type" | "range" | "enum" | "unknown-key" | "format" | "size";
      readonly rule?: ConfigRule;
      readonly receivedType?: "string" | "number" | "boolean" | "null" | "array" | "object";
      readonly receivedScalar?: string | number | boolean;
    };

export function configValueType(
  value: unknown,
): "string" | "number" | "boolean" | "null" | "array" | "object" | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return undefined;
  }
}

function sourceLabel(source: ConfigSource): string {
  switch (source.kind) {
    case "file":
      return source.path;
    case "environment":
      return `environment variable ${source.variable}`;
    case "override":
    case "resolved":
      return source.label;
  }
}

function ruleDescription(rule: ConfigRule): string {
  switch (rule.kind) {
    case "integer":
      return `an integer from ${rule.minimum} through ${rule.maximum}`;
    case "positive-decimal-integer-without-leading-zeros":
      return "a positive decimal integer without leading zeros";
    case "enum":
      return `one of ${rule.values.map((value) => JSON.stringify(value)).join(", ")}`;
    case "shape":
      return rule.expected === "object" ? "an object" : `a ${rule.expected}`;
    case "non-empty-absolute-path":
      return "a non-empty absolute path";
    case "https-url-without-credentials-or-fragment":
      return "an HTTPS URL without credentials or a fragment";
    case "max-bytes":
      return `no more than ${rule.maximum} bytes`;
  }
}

function reasonDescription(reason: Extract<ConfigFailure, { kind: "setting" }>["reason"]): string {
  switch (reason) {
    case "type":
      return "the expected type";
    case "range":
      return "the allowed range";
    case "enum":
      return "an allowed value";
    case "unknown-key":
      return "a recognized setting";
    case "format":
      return "the required format";
    case "size":
      return "the allowed size";
  }
}

function receivedDescription(failure: Extract<ConfigFailure, { kind: "setting" }>): string {
  if (failure.receivedType === undefined && failure.receivedScalar === undefined) return "";
  if (failure.receivedType === undefined)
    return ` Received ${JSON.stringify(failure.receivedScalar)}.`;
  if (failure.receivedScalar === undefined) return ` Received ${failure.receivedType}.`;
  return ` Received ${failure.receivedType} (${JSON.stringify(failure.receivedScalar)}).`;
}

/** Formats only typed, caller-approved configuration facts; it never includes parser or schema errors. */
export function formatConfigFailure(failure: ConfigFailure): string {
  if (failure.kind === "document") {
    switch (failure.reason) {
      case "yaml-syntax": {
        const location =
          failure.location === undefined
            ? ""
            : ` at line ${failure.location.line}, column ${failure.location.column}`;
        return `Invalid YAML${location}. Correct the document syntax in ${failure.source.path}.`;
      }
      case "unreadable":
        return `The configuration file could not be read. Check or repair ${failure.source.path}.`;
      case "not-file":
        return `${failure.source.path} is not a configuration file. Replace it with a YAML file.`;
      case "too-large":
        return `The configuration file exceeds the allowed size. Reduce its size: ${failure.source.path}.`;
      case "root-shape":
        return `The configuration document must have an object at its root. Correct ${failure.source.path}.`;
    }
  }

  const expected =
    failure.rule === undefined
      ? `must satisfy ${reasonDescription(failure.reason)}`
      : `must be ${ruleDescription(failure.rule)}`;
  return `Invalid ${failure.subject}: ${expected}. Correct or remove ${failure.subject} in ${sourceLabel(failure.source)}.${receivedDescription(failure)}`;
}

export class ConfigError extends Error {
  readonly failure?: ConfigFailure;

  constructor(failure?: ConfigFailure) {
    super(
      failure === undefined
        ? "The Lorelum configuration file is invalid or unreadable."
        : formatConfigFailure(failure),
    );
    this.name = "ConfigError";
    if (failure !== undefined) this.failure = failure;
  }
}
