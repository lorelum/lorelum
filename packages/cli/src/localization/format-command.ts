import { join } from "node:path";
import { formatPracticeMarkdown, serializeLocalizationManifest } from "@lorelum/format";
import type { CommandDefinition } from "../registry.js";
import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { frameworkErrorCodes, cliErrorCodes } from "../runtime/errors.js";
import { discoverPackFiles, readOptionalFile, writeAtomic } from "./filesystem.js";
import {
  assertCanonicalLocaleDirectories,
  assertLocalizedMarkdown,
  loadManifest,
  mirrorPath,
  visibleLocalizationError,
} from "./common.js";

const stringSchema: JsonSchema = { type: "string" };
const formatResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formattedFiles", "manifestFormatted"],
  properties: {
    formattedFiles: { type: "array", items: stringSchema },
    manifestFormatted: { type: "boolean" },
  },
};
const formatErrors = Object.freeze([...frameworkErrorCodes, cliErrorCodes.localizationInvalid]);

async function formatPack(packRoot: string): Promise<JsonValue> {
  const files = await discoverPackFiles(packRoot);
  assertCanonicalLocaleDirectories(files);
  assertLocalizedMarkdown(files);
  const writes: { path: string; content: string }[] = [];
  const formattedFiles: string[] = [];
  for (const [path, raw] of files.canonical) {
    // eslint-disable-next-line no-await-in-loop -- formatter ordering is deterministic
    const content = await formatPracticeMarkdown(raw);
    if (content !== raw) {
      writes.push({ path: join(packRoot, path), content });
      formattedFiles.push(path);
    }
  }
  for (const [locale, localized] of files.localized) {
    for (const [path, raw] of localized) {
      // eslint-disable-next-line no-await-in-loop -- formatter ordering is deterministic
      const content = await formatPracticeMarkdown(raw);
      if (content !== raw && mirrorPath(locale, path) !== undefined) {
        writes.push({ path: join(packRoot, path), content });
        formattedFiles.push(path);
      }
    }
  }
  let manifestFormatted = false;
  const manifestPath = join(packRoot, "i18n", "manifest.yaml");
  const manifest = await loadManifest(packRoot);
  if (manifest !== undefined) {
    const raw = await readOptionalFile(manifestPath);
    const content = serializeLocalizationManifest(manifest);
    manifestFormatted = raw !== content;
    if (manifestFormatted) writes.push({ path: manifestPath, content });
  }
  for (const write of writes) {
    // eslint-disable-next-line no-await-in-loop -- avoid concurrent replacement races
    await writeAtomic(write.path, write.content);
  }
  return { formattedFiles: formattedFiles.sort(), manifestFormatted };
}

export function createFormatCommand(): CommandDefinition {
  return {
    name: "format",
    summary: "Format canonical and localized Pack source files.",
    positionals: [{ name: "pack-root", required: true }],
    options: [],
    resultSchema: formatResultSchema,
    errorCodes: formatErrors,
    exitCodes: [0, 2],
    async handler({ positionals }) {
      try {
        return { data: await formatPack(positionals[0]!) };
      } catch (error) {
        visibleLocalizationError(error);
      }
    },
  };
}
