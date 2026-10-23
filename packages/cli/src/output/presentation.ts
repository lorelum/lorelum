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
  const backendProtocolVersion = data.backendProtocolVersion;
  const buildIdentity = stringField(data, "buildIdentity");
  const buildKind = stringField(data, "buildKind");
  const revision = data.revision;
  const dirty = data.dirty;
  if (
    toolVersion === undefined ||
    typeof protocolVersion !== "number" ||
    typeof backendProtocolVersion !== "number" ||
    buildIdentity === undefined ||
    buildKind === undefined ||
    (revision !== null && typeof revision !== "string") ||
    (dirty !== null && typeof dirty !== "boolean")
  ) {
    return fallback(data);
  }
  const revisionLabel = revision === null ? "unknown" : revision.slice(0, 12);
  const dirtyLabel = dirty === null ? "dirty state unknown" : dirty ? "dirty" : "clean";
  return [
    `Lorelum ${toolVersion}`,
    `CLI envelope protocol ${protocolVersion}; Backend internal protocol ${backendProtocolVersion}`,
    `Build ${buildIdentity.slice(0, 12)} (${buildKind}), revision ${revisionLabel}, ${dirtyLabel}`,
  ].join("\n");
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
