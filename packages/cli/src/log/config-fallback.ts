import type { ConfigFailure, LoggingResolution } from "@lorelum/config";
import { resolve } from "node:path";
import { safeErrorMessage } from "../output/safe-message.js";

type LoggingFallback = Extract<LoggingResolution, { kind: "fallback" }>;

/** Only the same classified document failure has already been explained by a terminal error. */
export function isSameDocumentFailure(
  left: ConfigFailure | undefined,
  right: ConfigFailure | undefined,
): boolean {
  if (left?.kind !== "document" || right?.kind !== "document") return false;
  if (resolve(left.source.path) !== resolve(right.source.path) || left.reason !== right.reason)
    return false;
  if (left.reason === "yaml-syntax" && right.reason === "yaml-syntax") {
    return (
      left.location?.line === right.location?.line &&
      left.location?.column === right.location?.column
    );
  }
  return true;
}

export function loggingFallbackNotice(fallback: LoggingFallback): string {
  const reason =
    fallback.cause.kind === "config"
      ? fallback.cause.error.message
      : "Logging settings could not be applied. Check the logging configuration before retrying.";
  return safeErrorMessage(
    `lorelum: persistent logging level fell back to ${fallback.fallbackLevel}; effective level is ${fallback.effectiveLevel}. ${reason}`,
  );
}
