import type { TraceId } from "@lorelum/log";

import type { JsonSchema, ProtocolDiagnostics } from "./protocol.js";

/** Categories of structured invocation facts a public response may expose. */
export const invocationNoticeKinds = ["configuration"] as const;
export type InvocationNoticeKind = (typeof invocationNoticeKinds)[number];

/** Small, stable reason vocabulary shared with the error-details contract. */
export const invocationNoticeReasons = [
  "missing",
  "invalid-type",
  "invalid-value",
  "out-of-range",
  "conflicting-options",
  "unknown-option",
  "unknown-command",
  "unknown-key",
  "syntax",
] as const;
export type InvocationNoticeReason = (typeof invocationNoticeReasons)[number];

/** What the owning runtime already verified about the expected value. */
export type InvocationNoticeExpected =
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "integer-range"; readonly min: number; readonly max: number }
  | { readonly kind: "type"; readonly name: string };

/** One runtime-owned non-fatal invocation fact attached to a public response. */
export interface InvocationNotice {
  readonly kind: InvocationNoticeKind;
  readonly subject: string;
  readonly reason: InvocationNoticeReason;
  readonly received?: string;
  readonly expected?: InvocationNoticeExpected;
  /** The value actually in effect for this invocation, e.g. after a fallback. */
  readonly effective?: string;
  /** Stable locator of the setting's source, e.g. the config file path. */
  readonly source?: string;
}

/**
 * Output budgets for public notices. `createInvocationNotice` enforces them so
 * every emitted notice carries bounded, byte-stable facts.
 */
export const invocationNoticeBudgets = Object.freeze({
  maxNotices: 5,
  subjectMaxLength: 120,
  receivedMaxLength: 120,
  effectiveMaxLength: 64,
  sourceMaxLength: 260,
  enumValuesMax: 16,
  enumValueMaxLength: 64,
  typeNameMaxLength: 64,
});

function truncate(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return truncate(value, maxLength);
}

function constrainExpected(expected: InvocationNoticeExpected): InvocationNoticeExpected {
  if (expected.kind === "enum") {
    return {
      kind: "enum",
      values: expected.values
        .slice(0, invocationNoticeBudgets.enumValuesMax)
        .map((value) => truncate(value, invocationNoticeBudgets.enumValueMaxLength)),
    };
  }
  if (expected.kind === "integer-range") {
    return { kind: "integer-range", min: expected.min, max: expected.max };
  }
  return { kind: "type", name: truncate(expected.name, invocationNoticeBudgets.typeNameMaxLength) };
}

/**
 * Builds a budget-constrained notice. Producers must construct notices only
 * through this factory: it truncates deterministically (by Unicode code point)
 * and drops empty optional strings, so identical input always yields identical
 * output.
 */
export function createInvocationNotice(input: InvocationNotice): InvocationNotice {
  if (input.subject.length === 0) {
    throw new TypeError("Invocation notice subject must not be empty.");
  }
  const received = optionalText(input.received, invocationNoticeBudgets.receivedMaxLength);
  const effective = optionalText(input.effective, invocationNoticeBudgets.effectiveMaxLength);
  const source = optionalText(input.source, invocationNoticeBudgets.sourceMaxLength);
  return Object.freeze({
    kind: input.kind,
    subject: truncate(input.subject, invocationNoticeBudgets.subjectMaxLength),
    reason: input.reason,
    ...(received === undefined ? {} : { received }),
    ...(input.expected === undefined ? {} : { expected: constrainExpected(input.expected) }),
    ...(effective === undefined ? {} : { effective }),
    ...(source === undefined ? {} : { source }),
  });
}

/** Caps a notice list to the public output budget, preserving producer order. */
export function capInvocationNotices(
  notices: readonly InvocationNotice[],
): readonly InvocationNotice[] {
  return notices.length <= invocationNoticeBudgets.maxNotices
    ? notices
    : notices.slice(0, invocationNoticeBudgets.maxNotices);
}

/**
 * Builds envelope diagnostics that carry invocation notices. Without notices the
 * result is the exact legacy shape, so unchanged invocations stay byte-identical.
 */
export function composeDiagnostics(
  traceId: TraceId,
  notices?: readonly InvocationNotice[],
): ProtocolDiagnostics {
  if (notices === undefined || notices.length === 0) return { traceId };
  return { traceId, notices: capInvocationNotices(notices) };
}

export const invocationNoticeExpectedSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "values"],
      properties: {
        kind: { const: "enum" },
        values: {
          type: "array",
          minItems: 1,
          maxItems: invocationNoticeBudgets.enumValuesMax,
          items: { type: "string" },
        },
      },
    },
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
      required: ["kind", "name"],
      properties: { kind: { const: "type" }, name: { type: "string" } },
    },
  ],
};

export const invocationNoticeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "subject", "reason"],
  properties: {
    kind: { enum: [...invocationNoticeKinds] },
    subject: { type: "string" },
    reason: { enum: [...invocationNoticeReasons] },
    received: { type: "string" },
    expected: invocationNoticeExpectedSchema,
    effective: { type: "string" },
    source: { type: "string" },
  },
};
