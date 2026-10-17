import type { Logger } from "@lorelum/log";

/** Native Hooks accept extra keys and validate only fields used by an operation. */
export function readPayload<T>(
  payload: unknown,
  label: string,
  byteLength: number,
  log?: Logger,
): T {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`Lorelum ${label} Hook input must be a JSON object.`);
  }
  log?.debug("hook.payload.received", {
    byteLength,
    ...("hook_event_name" in payload && typeof payload.hook_event_name === "string"
      ? { hookEventName: payload.hook_event_name }
      : {}),
  });
  return payload as T;
}

/** Preserve the native empty-result classification, including case variants on failure. */
export function optionalEventFallback(payload: unknown): {} | { readonly continue: true } {
  const event =
    typeof payload === "object" && payload !== null && "hook_event_name" in payload
      ? payload.hook_event_name
      : undefined;
  const normalized = typeof event === "string" ? event.toLowerCase() : undefined;
  return normalized === "pretooluse" ||
    normalized === "posttooluse" ||
    normalized === "subagentstart"
    ? {}
    : { continue: true };
}
