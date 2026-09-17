import type { JsonValue } from "./protocol.js";

export type StructuredTextRenderer = (value: JsonValue) => string;

/**
 * Renders every JSON-safe value in a compact tree for people. This is deliberately
 * not a parseable data format: `--json` remains the machine contract.
 */
export const renderStructuredText: StructuredTextRenderer = (value) => {
  const lines: string[] = [];
  appendRoot(lines, value);
  return lines.join("\n");
};

function appendRoot(lines: string[], value: JsonValue): void {
  if (isObject(value)) {
    if (Object.keys(value).length === 0) {
      lines.push("{}");
      return;
    }
    appendObject(lines, value, 0);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push("[]");
      return;
    }
    appendArray(lines, value, 0);
    return;
  }
  appendScalar(lines, value, 0, "");
}

function appendObject(
  lines: string[],
  value: Readonly<Record<string, unknown>>,
  indent: number,
): void {
  for (const [key, nested] of Object.entries(value)) {
    appendEntry(lines, key, nested as JsonValue, indent);
  }
}

function appendArray(lines: string[], value: readonly JsonValue[], indent: number): void {
  const prefix = indentation(indent);
  for (const item of value) {
    if (isSingleLineScalar(item)) {
      lines.push(`${prefix}- ${scalarText(item)}`);
      continue;
    }
    if (isMultilineString(item)) {
      lines.push(`${prefix}- |`);
      appendMultiline(lines, item, indent + 2);
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${prefix}- []`);
      } else {
        lines.push(`${prefix}-`);
        appendArray(lines, item, indent + 2);
      }
      continue;
    }
    if (!isObject(item))
      throw new TypeError("Expected a JSON object after scalar and array checks.");
    if (Object.keys(item).length === 0) {
      lines.push(`${prefix}- {}`);
      continue;
    }
    lines.push(`${prefix}-`);
    appendObject(lines, item, indent + 2);
  }
}

function appendEntry(lines: string[], key: string, value: JsonValue, indent: number): void {
  const prefix = `${indentation(indent)}${key}:`;
  if (isSingleLineScalar(value)) {
    lines.push(`${prefix} ${scalarText(value)}`);
    return;
  }
  if (isMultilineString(value)) {
    lines.push(`${prefix} |`);
    appendMultiline(lines, value, indent + 2);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix} []`);
      return;
    }
    lines.push(prefix);
    appendArray(lines, value, indent + 2);
    return;
  }
  if (!isObject(value))
    throw new TypeError("Expected a JSON object after scalar and array checks.");
  if (Object.keys(value).length === 0) {
    lines.push(`${prefix} {}`);
    return;
  }
  lines.push(prefix);
  appendObject(lines, value, indent + 2);
}

function appendScalar(lines: string[], value: JsonValue, indent: number, prefix: string): void {
  if (!isSingleLineScalar(value)) throw new TypeError("Expected a JSON scalar.");
  lines.push(`${indentation(indent)}${prefix}${scalarText(value)}`);
}

function appendMultiline(lines: string[], value: string, indent: number): void {
  for (const line of value.split(/\r\n|\r|\n/u)) {
    lines.push(`${indentation(indent)}${line}`);
  }
}

function isObject(value: JsonValue): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMultilineString(value: JsonValue): value is string {
  return typeof value === "string" && /[\r\n]/u.test(value);
}

function isSingleLineScalar(value: JsonValue): value is null | boolean | number | string {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    (typeof value === "string" && !isMultilineString(value))
  );
}

function scalarText(value: null | boolean | number | string): string {
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? '""' : value;
  return String(value);
}

function indentation(size: number): string {
  return " ".repeat(size);
}
