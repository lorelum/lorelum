import type { JsonValue } from "./protocol.js";
import type { TextRenderer } from "./render.js";

/** A compact header for Help while the fallback retains every capability field. */
export const renderHelpText: TextRenderer = (data, fallback) => {
  if (!isObject(data)) return fallback(data);
  const name = stringField(data, "name") ?? "Lorelum";
  const summary = stringField(data, "summary");
  const usage = stringField(data, "usage");
  const commands = arrayField(data, "commands");
  const commandLines = commands
    ?.flatMap((command) => {
      if (!isObject(command)) return [];
      const commandName = stringField(command, "name");
      const commandSummary = stringField(command, "summary");
      return commandName === undefined
        ? []
        : [`  ${commandName}${commandSummary === undefined ? "" : ` — ${commandSummary}`}`];
    })
    .filter((line) => line.length > 0);
  const heading = [name, ...(summary === undefined ? [] : [summary])].join("\n");
  const sections = [heading, ...(usage === undefined ? [] : [`Usage: ${usage}`])];
  if (commandLines !== undefined && commandLines.length > 0) {
    sections.push(`Commands:\n${commandLines.join("\n")}`);
  }
  sections.push(`Complete command contract:\n${fallback(data)}`);
  return sections.join("\n\n");
};

export const renderVersionText: TextRenderer = (data, fallback) => {
  if (!isObject(data)) return fallback(data);
  const toolVersion = stringField(data, "toolVersion");
  const protocolVersion = data.protocolVersion;
  if (toolVersion === undefined || typeof protocolVersion !== "number") return fallback(data);
  return `Lorelum ${toolVersion} (protocol ${protocolVersion})`;
};

function isObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Readonly<Record<string, JsonValue>>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function arrayField(
  value: Readonly<Record<string, JsonValue>>,
  key: string,
): readonly JsonValue[] | undefined {
  const field = value[key];
  return Array.isArray(field) ? field : undefined;
}
