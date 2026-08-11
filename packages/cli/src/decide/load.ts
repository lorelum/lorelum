/**
 * Pack input loading for `lore decide`: validates the pack directory, enforces
 * the 256KiB decisions.yaml cap, and parses through @lorelum/format with
 * failures mapped to pack.* codes (ADR 0008 §7).
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  DecisionDocumentError,
  parseDecisionDocument,
  parseYaml,
  type DecisionNode,
} from "@lorelum/format";

import { CliError, cliErrorCodes } from "../runtime/errors.js";

/**
 * Max bytes for the decisions document. Matches the fork reference
 * implementation's v1PackInputLimits.maxDecisionBytes so oversized pack input
 * is rejected before the guarded YAML parser runs (ADR 0008 §decisions).
 */
const maxDecisionsBytes = 256 * 1024;

/**
 * Read and parse <pack-path>/decisions.yaml for the decide command. The pack
 * path must be a readable directory; a missing document, an oversized
 * document, or unparseable YAML is a pack error, not a runtime failure.
 *
 * Every failure here is thrown as a CliError with a pack code, including the
 * format layer's DecisionDocumentError, so the framework error mapper never
 * needs to know format error classes.
 */
export async function readDecisionsDocument(packPath: string): Promise<DecisionNode[]> {
  await requireReadableDirectory(packPath);
  const content = await readDecisionsFile(join(packPath, "decisions.yaml"));
  // An empty YAML document is an empty decision list, matching the fork
  // reference behavior (ADR 0008 §decisions). A non-list document is mapped
  // to pack.parse_error here, at the CLI boundary (ADR 0008 §7).
  try {
    return parseDecisionDocument(parsePackYaml(content));
  } catch (error) {
    if (error instanceof DecisionDocumentError) {
      throw new CliError(cliErrorCodes.packParseError, error.message);
    }
    throw error;
  }
}

/** Require <pack-path> to be a readable directory; otherwise pack.path_invalid. */
async function requireReadableDirectory(packPath: string): Promise<void> {
  let metadata;
  try {
    metadata = await stat(packPath);
  } catch {
    throw packPathInvalid();
  }
  if (!metadata.isDirectory()) throw packPathInvalid();
}

/** Read decisions.yaml with a pre-read byte cap; missing or oversized is pack.unreadable. */
async function readDecisionsFile(decisionsPath: string): Promise<string> {
  let metadata;
  try {
    metadata = await stat(decisionsPath);
  } catch {
    throw packUnreadable();
  }
  if (metadata.size > maxDecisionsBytes) throw packUnreadable();
  let content: string;
  try {
    content = await readFile(decisionsPath, "utf8");
  } catch {
    throw packUnreadable();
  }
  // Re-check the byte length after reading: a file replaced between stat and
  // read can bypass the pre-read cap, and string length counts UTF-16 code
  // units rather than bytes. Keep the enforced cap on the actual content
  // (ADR 0008 §7).
  if (Buffer.byteLength(content, "utf8") > maxDecisionsBytes) throw packUnreadable();
  return content;
}

/** Parse guarded YAML; malformed input is a pack parse error. */
function parsePackYaml(content: string): unknown {
  try {
    return parseYaml(content);
  } catch {
    throw packParseError();
  }
}

/** The decisions document could not be parsed or is not a list of decision nodes. */
function packParseError(message = "The decisions document could not be parsed."): CliError {
  return new CliError(cliErrorCodes.packParseError, message);
}

/** The pack path is not a readable directory. */
function packPathInvalid(): CliError {
  return new CliError(cliErrorCodes.packPathInvalid, "The pack path must be a readable directory.");
}

/** The decisions document is missing, unreadable, or oversized. */
function packUnreadable(): CliError {
  return new CliError(cliErrorCodes.packUnreadable, "The decisions document could not be read.");
}
