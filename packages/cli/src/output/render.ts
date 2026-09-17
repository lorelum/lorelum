import {
  assertJsonValue,
  createFailureEnvelope,
  createSuccessEnvelope,
  type ErrorRecovery,
  type JsonValue,
  type OutputWriter,
} from "./protocol.js";
import { renderStructuredText, type StructuredTextRenderer } from "./structured-text.js";

export type OutputFormat = "json" | "text";

/** Pure layout override. It receives no invocation, I/O client, or mutable runtime state. */
export type TextRenderer = (data: JsonValue, fallback: StructuredTextRenderer) => string;

export type RenderableResult =
  | Readonly<{
      kind: "success";
      command: string;
      data: JsonValue;
      textRenderer?: TextRenderer;
    }>
  | Readonly<{
      kind: "failure";
      command: string;
      code: string;
      message: string;
      recovery?: ErrorRecovery;
    }>;

/** The only output-format decision point for ordinary CLI responses. */
export function renderResult(
  writer: OutputWriter,
  format: OutputFormat,
  result: RenderableResult,
): void {
  if (result.kind === "success") {
    assertJsonValue(result.data);
    if (format === "json") {
      writeLine(writer, JSON.stringify(createSuccessEnvelope(result.command, result.data)));
      return;
    }
    const text = (result.textRenderer ?? renderStructuredText)(result.data, renderStructuredText);
    if (text.length === 0) throw new TypeError("Text renderer returned an empty response.");
    writeText(writer, text);
    return;
  }

  if (format === "json") {
    writeLine(
      writer,
      JSON.stringify(
        createFailureEnvelope(result.command, result.code, result.message, result.recovery),
      ),
    );
    return;
  }
  writeText(
    writer,
    renderStructuredText({
      error: {
        code: result.code,
        message: result.message,
        ...(result.recovery === undefined ? {} : { recovery: result.recovery }),
      },
    }),
  );
}

function writeLine(writer: OutputWriter, line: string): void {
  writer.write(`${line}\n`);
}

function writeText(writer: OutputWriter, text: string): void {
  writer.write(text.endsWith("\n") ? text : `${text}\n`);
}
