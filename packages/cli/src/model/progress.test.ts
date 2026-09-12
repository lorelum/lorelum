import { expect, test } from "bun:test";
import { createModelProgressReporter } from "./progress";
import { ENCODING_ID, type ModelStatus } from "@lorelum/backend/protocol";

test("CLI progress reports changed percentage and attempts without flooding output", () => {
  const lines: string[] = [];
  const report = createModelProgressReporter({
    write: (line) => {
      lines.push(line);
    },
  });
  const status: ModelStatus = {
    state: "loading",
    encodingId: ENCODING_ID,
    dimensions: 384,
    device: "cpu",
    threads: 4,
    progress: { phase: "downloading", downloadedBytes: 10, totalBytes: 100, attempt: 1 },
  };
  report(status);
  report(status);
  report({ ...status, progress: { ...status.progress!, attempt: 2 } });
  report({ ...status, progress: { phase: "verifying" } });
  expect(lines).toEqual([
    "model: downloading 10% (attempt 1)\n",
    "model: downloading 10% (attempt 2)\n",
    "model: verifying\n",
  ]);
});
