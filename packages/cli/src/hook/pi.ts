import type { Logger } from "@lorelum/log";

import type { OutputWriter } from "../output/protocol.js";
import {
  buildPiHookResponse,
  createHostHookResponse,
  parseHostHookInvocation,
  runHostHook,
  type HostHookInput,
  type HostHookInvocation,
  type HostHookServices,
  type PiHookResponse,
  type TextInput,
} from "./host-hook.js";

export type PiHookInput = HostHookInput;
export type PiHookServices = HostHookServices;
export type PiHookInvocation = HostHookInvocation;
export type { PiHookEvent, PiHookResponse } from "./host-hook.js";
export type { TextInput } from "./host-hook.js";

export interface RunPiHookOptions {
  readonly stdin: TextInput;
  readonly stdout: OutputWriter;
  readonly stderr: OutputWriter;
  readonly services?: PiHookServices;
  readonly storeRoot?: string;
  readonly log?: Logger;
}

/** Detect the raw Pi Extension Hook ABI and consume its only supported global option. */
export function parsePiHookInvocation(arguments_: readonly string[]): PiHookInvocation | undefined {
  return parseHostHookInvocation(arguments_, "pi");
}

/**
 * Execute the versioned raw Pi Extension Hook ABI. It deliberately does not
 * emit the normal Lorelum CLI envelope: the Pi Extension adapter consumes this
 * flat `additionalContext` object directly.
 */
export async function runPiHook(options: RunPiHookOptions): Promise<0> {
  return runHostHook({ ...options, host: "pi" });
}

export async function createPiHookResponse(
  input: PiHookInput,
  services?: PiHookServices,
  storeRoot?: string,
): Promise<PiHookResponse> {
  return createHostHookResponse(input, "pi", services, storeRoot);
}

export { buildPiHookResponse };
