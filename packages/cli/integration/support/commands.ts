import { runProcess, type ProcessResult } from "./process.js";

export async function runGet(
  binaryPath: string,
  practiceId: string,
  storageRoot: string,
  globalPosition: "before" | "after" = "after",
): Promise<ProcessResult> {
  const args =
    globalPosition === "before"
      ? [binaryPath, "--store-root", storageRoot, "get", practiceId]
      : [binaryPath, "get", practiceId, "--store-root", storageRoot];
  return runProcess(args);
}

export async function runList(
  binaryPath: string,
  storageRoot: string,
  options: { readonly packName?: string; readonly scope?: "packs" } = {},
): Promise<ProcessResult> {
  const args = [binaryPath, "list"];
  if (options.scope !== undefined) args.push(options.scope);
  if (options.packName !== undefined) args.push("--pack", options.packName);
  args.push("--store-root", storageRoot);
  return runProcess(args);
}

export async function runQuery(
  binaryPath: string,
  text: string,
  storageRoot: string,
  topK?: number,
  mode: "keyword" | "semantic" = "keyword",
): Promise<ProcessResult> {
  const args = [binaryPath, "query", text, "--mode", mode, "--store-root", storageRoot];
  if (topK !== undefined) args.push("--top-k", String(topK));
  return runProcess(args);
}
