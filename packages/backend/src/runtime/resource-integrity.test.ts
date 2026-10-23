import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogSink, SinkLogEmitter } from "@lorelum/log";
import { verifyResource } from "./resource-integrity";

// Debug evidence must describe the check that actually failed, without rereading the resource.
test.each(["missing", "size-mismatch", "sha256-mismatch"] as const)(
  "resource debug evidence retains the path and %s facts",
  async (check) => {
    const directory = await mkdtemp(join(tmpdir(), "lore-resource-debug-"));
    const path = join(directory, "model.gguf");
    const sink = new MemoryLogSink();
    const digest = createHash("sha256").update("correct").digest("hex");
    const resource = { kind: "model", file: "model.gguf" } as const;
    const bytes = check === "size-mismatch" ? 6 : 7;
    try {
      if (check !== "missing") await writeFile(path, "invalid");
      await expect(
        verifyResource(
          path,
          bytes,
          digest,
          new AbortController().signal,
          resource,
          new SinkLogEmitter(sink),
        ),
      ).rejects.toMatchObject({ code: "embedding.resource-invalid", resource: { check } });
      expect(sink.records).toEqual([
        expect.objectContaining({
          level: "debug",
          message: "backend.resource.verifying",
          context: { path, resource, expectedBytes: bytes, expectedSha256: digest },
        }),
        expect.objectContaining({
          level: "debug",
          message: "backend.resource.failed",
          context: {
            path,
            resource: {
              ...resource,
              check,
              ...(check === "missing"
                ? {}
                : {
                    expected: check === "size-mismatch" ? "6" : digest,
                    actual:
                      check === "size-mismatch"
                        ? "7"
                        : createHash("sha256").update("invalid").digest("hex"),
                  }),
            },
          },
        }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
