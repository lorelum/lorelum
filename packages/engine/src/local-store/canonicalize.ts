import { createHash } from "node:crypto";
import { posix } from "node:path";

import type { Practice } from "@lorelum/format";

import { InvalidPreparedPackError } from "./errors";
import type { SnapshotFile } from "./types";

const DEFAULT_SEVERITY = "warn";

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function hashParts(parts: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest("hex");
}

function encodedPart(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return new TextEncoder().encode(`${bytes.byteLength}:`);
}

export function normalizeSnapshotPath(relativePath: string): string {
  const normalizedInput = relativePath.replace(/\\/g, "/");
  const normalized = posix.normalize(normalizedInput);

  if (
    normalizedInput.includes("\0") ||
    /^[a-z]:/i.test(normalizedInput) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalizedInput.startsWith("/")
  ) {
    throw new InvalidPreparedPackError(`Unsafe snapshot path "${relativePath}"`);
  }

  return normalized;
}

export function artifactDigest(files: readonly SnapshotFile[]): string {
  const normalized = files
    .map((file) => ({ ...file, relativePath: normalizeSnapshotPath(file.relativePath) }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const seen = new Set<string>();
  const parts: Uint8Array[] = [];

  for (const file of normalized) {
    if (seen.has(file.relativePath)) {
      throw new InvalidPreparedPackError(`Duplicate snapshot path "${file.relativePath}"`);
    }
    seen.add(file.relativePath);
    parts.push(encodedPart(file.relativePath), new TextEncoder().encode(file.relativePath));
    parts.push(encodedPart(file.bytes), file.bytes);
  }

  return hashParts(parts);
}

export function storageKey(packName: string): string {
  let output = "";
  for (const character of packName) {
    output += /[a-z0-9-]/.test(character)
      ? character
      : `_${character.codePointAt(0)?.toString(16) ?? ""}_`;
  }
  return output;
}

export function canonicalContent(practice: Practice): string {
  const antiPatterns = (practice.anti_patterns ?? []).map((antiPattern) => ({
    id: normalizeText(antiPattern.id),
    name: normalizeText(antiPattern.name),
    description: normalizeText(antiPattern.description),
    severity: antiPattern.severity ?? null,
  }));

  return JSON.stringify({
    id: normalizeText(practice.id),
    title: normalizeText(practice.title),
    stage: normalizeText(practice.stage),
    tech_stack: practice.tech_stack.map(normalizeText),
    applies_when: normalizeText(practice.applies_when),
    severity: practice.severity ?? DEFAULT_SEVERITY,
    body: normalizeText(practice.body ?? ""),
    anti_patterns: antiPatterns,
  });
}

export function contentDigest(practice: Practice): string {
  return hashParts([new TextEncoder().encode(canonicalContent(practice))]);
}
