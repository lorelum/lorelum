import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";

import type { PackFileSystem } from "./types.js";

/**
 * Node adapter for ADR 0006's trusted-local threat model. Descriptor stat and
 * O_NOFOLLOW checks are defense in depth; callers must prevent untrusted concurrent
 * mutation of the selected pack namespace.
 */
export function createNodePackFileSystem(): PackFileSystem {
  return {
    async lstat(path) {
      try {
        const metadata = await lstat(path, { bigint: true });
        return {
          identity: `${metadata.dev}:${metadata.ino}`,
          kind: toKind(metadata),
          size:
            metadata.size > BigInt(Number.MAX_SAFE_INTEGER)
              ? Number.POSITIVE_INFINITY
              : Number(metadata.size),
        };
      } catch (error) {
        if (isMissingFile(error)) return { identity: undefined, kind: "missing", size: 0 };
        throw error;
      }
    },
    async readDirectory(path) {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({ kind: toKind(entry), name: entry.name }));
    },
    async readRegularFile(path, maxBytes) {
      const pathMetadata = await lstat(path);
      if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || pathMetadata.size > maxBytes) {
        throw new Error("unreadable input");
      }

      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size > maxBytes) throw new Error("unreadable input");

        const content = Buffer.alloc(metadata.size);
        let offset = 0;
        while (offset < content.length) {
          // A descriptor read can be partial, so each read advances from the prior offset.
          // eslint-disable-next-line no-await-in-loop
          const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
          if (bytesRead === 0) throw new Error("unexpected end of file");
          offset += bytesRead;
        }

        const overflow = Buffer.alloc(1);
        if ((await handle.read(overflow, 0, overflow.length, content.length)).bytesRead !== 0)
          throw new Error("input changed while reading");
        return content.toString("utf8");
      } finally {
        await handle.close();
      }
    },
  };
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function toKind(entry: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }) {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}
