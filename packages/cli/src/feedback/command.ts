import {
  readTraceDiagnosticFacts,
  type TraceDiagnosticProjection,
} from "@lorelum/backend/diagnostics";
import { defaultFeedbackDirectory } from "@lorelum/config";
import { isTraceId, type TraceId } from "@lorelum/log";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { frameworkErrorCodes, invalidInvocationError } from "../runtime/errors.js";
import { publishFeedbackArtifact } from "./artifacts.js";
import {
  parseFeedbackDraftInput,
  renderReportMarkdown,
  reportFromInput,
  reportFromTrace,
} from "./report.js";
import { feedbackKinds, type FeedbackKind, type FeedbackReport } from "./types.js";
import { readTraceLogs, type FeedbackLogLevel, type TraceLogSelection } from "./logs.js";

export interface FeedbackCommandServices {
  readonly readTraceDiagnostics: (traceId: TraceId) => Promise<TraceDiagnosticProjection>;
  readonly defaultOutputDirectory: () => string;
  readonly readInput: (source: string) => Promise<string>;
  readonly publish: (
    outputDirectory: string,
    report: FeedbackReport,
    markdown: string,
  ) => Promise<{ readonly reportPath: string; readonly markdownPath: string }>;
  readonly readTraceLogs?: (
    traceId: TraceId,
    level: FeedbackLogLevel,
  ) => Promise<TraceLogSelection>;
}

const feedbackDraftSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "reportPath", "markdownPath", "summary", "externalReview", "missingEvidence"],
  properties: {
    state: { const: "draft" },
    reportPath: { type: "string" },
    markdownPath: { type: "string" },
    summary: { type: "string" },
    externalReview: {
      type: "object",
      additionalProperties: false,
      required: ["required", "selectedRawFields", "credentialSignals"],
      properties: {
        required: { type: "boolean" },
        selectedRawFields: { type: "array", items: { type: "string" } },
        credentialSignals: { type: "array", items: { type: "string" } },
      },
    },
    missingEvidence: { type: "array", items: { type: "string" } },
  },
};

function isKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && (feedbackKinds as readonly string[]).includes(value);
}

async function defaultReadInput(source: string): Promise<string> {
  if (source === "-") return Bun.stdin.text();
  return Bun.file(source).text();
}

const defaultServices: FeedbackCommandServices = Object.freeze({
  readTraceDiagnostics: readTraceDiagnosticFacts,
  defaultOutputDirectory: defaultFeedbackDirectory,
  readInput: defaultReadInput,
  publish: publishFeedbackArtifact,
});

/** Explicit local-only report generation. No service here starts Backend or uses the network. */
export function createFeedbackCommand(
  services: FeedbackCommandServices = defaultServices,
): CommandDefinition {
  return {
    name: "feedback.draft",
    summary: "Create a local, reviewable feedback draft from one trace or an advanced input file.",
    positionals: [],
    options: [
      {
        longFlag: "--trace-id",
        description: "Use one normal CLI diagnostics trace as the local evidence root.",
        value: { name: "trace-id", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--kind",
        description: "Choose whether this local draft describes a bug or an improvement.",
        value: { name: "kind", required: true },
        optionRequired: false,
        values: feedbackKinds,
      },
      {
        longFlag: "--include-logs",
        description:
          "Keep the default info logs explicit, or add already-recorded same-trace debug logs.",
        value: { name: "level", required: true },
        optionRequired: false,
        values: ["info", "debug"],
      },
      {
        longFlag: "--output",
        description: "Write a unique draft directory below this local directory.",
        value: { name: "directory", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--input",
        description: "Advanced: load a versioned manual observation from a file or stdin (-).",
        value: { name: "file", required: true },
        optionRequired: false,
      },
    ],
    resultSchema: feedbackDraftSchema,
    errorCodes: frameworkErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      const traceValue = invocation.options.traceId;
      const inputValue = invocation.options.input;
      const outputValue = invocation.options.output;
      const kindValue = invocation.options.kind;
      const includeLogs = invocation.options.includeLogs;
      if ((traceValue === undefined) === (inputValue === undefined))
        throw invalidInvocationError("Provide exactly one of --trace-id or --input.");
      if (outputValue !== undefined && typeof outputValue !== "string")
        throw invalidInvocationError("--output must be a directory path.");
      if (kindValue !== undefined && !isKind(kindValue))
        throw invalidInvocationError(`--kind must be ${feedbackKinds.join(" or ")}.`);
      if (includeLogs !== undefined && includeLogs !== "info" && includeLogs !== "debug")
        throw invalidInvocationError("--include-logs must be info or debug.");
      const outputDirectory =
        outputValue === undefined ? services.defaultOutputDirectory() : outputValue;
      try {
        let report: FeedbackReport;
        if (traceValue !== undefined) {
          if (typeof traceValue !== "string" || !isTraceId(traceValue) || !isKind(kindValue)) {
            throw invalidInvocationError(
              "--trace-id must be a valid trace ID and requires --kind.",
            );
          }
          const projection = await services.readTraceDiagnostics(traceValue);
          const detailed = await (services.readTraceLogs ?? readTraceLogs)(
            traceValue,
            includeLogs === "debug" ? "debug" : "info",
          );
          report = reportFromTrace(traceValue, kindValue, projection, detailed);
        } else {
          if (typeof inputValue !== "string" || includeLogs !== undefined)
            throw invalidInvocationError(
              "--input must be a file path or -, and cannot be combined with --include-logs.",
            );
          const parsed = parseFeedbackDraftInput(JSON.parse(await services.readInput(inputValue)));
          if (kindValue !== undefined && kindValue !== parsed.kind)
            throw invalidInvocationError("--kind must match the kind in the input file.");
          report = reportFromInput(parsed);
        }
        const artifact = await services.publish(
          outputDirectory,
          report,
          renderReportMarkdown(report),
        );
        return {
          data: {
            state: "draft",
            reportPath: artifact.reportPath,
            markdownPath: artifact.markdownPath,
            summary: report.summary,
            externalReview: {
              required: report.externalReview.required,
              selectedRawFields: [...report.externalReview.selectedRawFields],
              credentialSignals: [...report.externalReview.credentialSignals],
            },
            missingEvidence: [...report.missingEvidence],
          } satisfies JsonValue,
        };
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError)
          throw invalidInvocationError(
            "Invalid feedback input. Check the input file's JSON and required fields.",
          );
        throw error;
      }
    },
  };
}

export { feedbackDraftSchema };
