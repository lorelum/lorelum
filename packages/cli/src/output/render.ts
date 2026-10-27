import {
  createFailureEnvelope,
  createSuccessEnvelope,
  type JsonValue,
  type OutputWriter,
  type ProtocolDiagnostics,
} from "./protocol.js";
import type { ResourceFailure } from "@lorelum/backend/protocol";
import { createTraceId } from "@lorelum/log";
import { renderStructuredText, type StructuredTextRenderer } from "./structured-text.js";
import { safeErrorMessage } from "./safe-message.js";

export type OutputFormat = "json" | "text";

/** Pure layout override. It receives no invocation, I/O client, or mutable runtime state. */
export type TextRenderer = (data: JsonValue, fallback: StructuredTextRenderer) => string;

export type RenderableResult =
  | Readonly<{
      kind: "success";
      command: string;
      data: JsonValue;
      textRenderer?: TextRenderer;
      diagnostics?: ProtocolDiagnostics;
    }>
  | Readonly<{
      kind: "failure";
      command: string;
      code: string;
      message: string;
      resource?: ResourceFailure;
      diagnostics?: ProtocolDiagnostics;
    }>;

/** The only output-format decision point for ordinary CLI responses. */
export function renderResult(
  writer: OutputWriter,
  format: OutputFormat,
  result: RenderableResult,
): void {
  if (result.kind === "success") {
    if (format === "json") {
      writeLine(
        writer,
        JSON.stringify(
          createSuccessEnvelope(
            result.command,
            result.data,
            result.diagnostics ?? { traceId: createTraceId() },
          ),
        ),
      );
      return;
    }
    const text = (result.textRenderer ?? renderStructuredText)(result.data, renderStructuredText);
    if (text.length === 0) throw new TypeError("Text renderer returned an empty response.");
    writeText(writer, text);
    return;
  }

  // Compatibility guidance includes both full build IDs and the complete recovery
  // command. Keep that diagnostic intact without widening ordinary error output.
  const message = safeErrorMessage(
    result.message,
    result.code === "backend.protocol-mismatch" ? 2048 : 400,
  );
  if (format === "json") {
    writeLine(
      writer,
      JSON.stringify(
        createFailureEnvelope(
          result.command,
          result.code,
          message,
          result.diagnostics ?? { traceId: createTraceId() },
          result.resource,
        ),
      ),
    );
    return;
  }
  writeText(
    writer,
    renderStructuredText({
      error: {
        code: result.code,
        message,
        ...(result.resource === undefined ? {} : { resource: result.resource }),
      },
      diagnostics: result.diagnostics ?? { traceId: createTraceId() },
    }),
  );
}

function writeLine(writer: OutputWriter, line: string): void {
  writer.write(`${line}\n`);
}

function writeText(writer: OutputWriter, text: string): void {
  writer.write(text.endsWith("\n") ? text : `${text}\n`);
}
