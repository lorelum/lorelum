import type { RevisionDelta } from "../../model";

import { SqliteStateError } from "../errors";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function serializeRevisionDelta(delta: RevisionDelta): string {
  return JSON.stringify({
    added: [...delta.added],
    changed: [...delta.changed],
    invalidated: [...delta.invalidated],
  });
}

export function parseRevisionDelta(text: string): RevisionDelta {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SqliteStateError("revision delta is not JSON", error);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SqliteStateError("revision delta has an unsupported shape");
  }
  const record = value as Record<string, unknown>;
  if (
    !isStringArray(record.added) ||
    !isStringArray(record.changed) ||
    !isStringArray(record.invalidated)
  ) {
    throw new SqliteStateError("revision delta has an unsupported shape");
  }
  return Object.freeze({
    added: Object.freeze([...record.added]),
    changed: Object.freeze([...record.changed]),
    invalidated: Object.freeze([...record.invalidated]),
  });
}
