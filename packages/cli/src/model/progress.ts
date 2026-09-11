import type { ModelStatus } from "@lorelum/backend/protocol";
import type { OutputWriter } from "../output/protocol";

/** Keep stdout's single-result contract; emit only changed phase, percent or retry attempt. */
export function createModelProgressReporter(writer: OutputWriter) {
  let previous = "";
  return (status: ModelStatus) => {
    const progress = status.progress;
    if (!progress) return;
    const percent =
      progress.totalBytes && progress.downloadedBytes !== undefined
        ? Math.floor((progress.downloadedBytes * 100) / progress.totalBytes)
        : undefined;
    const message = `model: ${progress.phase}${percent === undefined ? "" : ` ${percent}%`}${progress.attempt ? ` (attempt ${progress.attempt})` : ""}`;
    if (message !== previous) {
      writer.write(`${message}\n`);
      previous = message;
    }
  };
}
