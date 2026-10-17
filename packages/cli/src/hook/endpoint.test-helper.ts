import type { Logger } from "@lorelum/log";
import { createHookEndpoint, type HookServiceOverrides } from "./command.js";
import { runHook } from "./runner.js";
import type { HookHost, HookIO } from "./types.js";

/** Exercise the production composition and transport without a process-wide main runtime. */
export function invokeHook(
  host: HookHost,
  options: Omit<HookIO, "host"> & {
    readonly services?: Partial<HookServiceOverrides>;
    readonly storeRoot?: string;
    readonly log?: Logger;
  },
): Promise<0> {
  const endpoint = createHookEndpoint(host, options.services, options.storeRoot, options.log);
  return runHook(endpoint, { ...options, host });
}
