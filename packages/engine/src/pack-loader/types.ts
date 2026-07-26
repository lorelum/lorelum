import type { UnvalidatedPackInput } from "@lorelum/format";

export type PackEntryKind = "directory" | "file" | "missing" | "other" | "symlink";

export interface PackDirectoryEntry {
  kind: PackEntryKind;
  name: string;
}

export interface PackFileMetadata {
  /** Opaque identity stable for the lifetime of an entry; undefined only when missing. */
  identity: string | undefined;
  kind: PackEntryKind;
  size: number;
}

/**
 * Filesystem port for an explicitly selected, trusted local authoring or CI pack.
 * It does not promise atomic isolation from hostile concurrent namespace changes;
 * callers must satisfy the threat model in ADR 0006.
 */
export interface PackFileSystem {
  lstat(path: string): Promise<PackFileMetadata>;
  readDirectory(path: string): Promise<readonly PackDirectoryEntry[]>;
  readRegularFile(path: string, maxBytes: number): Promise<string>;
}

export interface PackLoader {
  load(packPath: string): Promise<UnvalidatedPackInput>;
}

export class PackLoadError extends Error {
  constructor(
    readonly code: "pack.parse_error" | "pack.path_invalid" | "pack.unreadable",
    message: string,
  ) {
    super(message);
    this.name = "PackLoadError";
  }
}
