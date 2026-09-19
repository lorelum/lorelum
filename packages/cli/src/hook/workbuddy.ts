import type { ListPackDetailsResult } from "@lorelum/engine";

import type { OutputWriter } from "../output/protocol.js";
import {
  buildHostHookResponse,
  createHostHookResponse,
  parseHostHookInvocation,
  runHostHook,
  type HostHookEvent,
  type HostHookInput,
  type HostHookInvocation,
  type HostHookResponse,
  type HostHookServices,
  type TextInput,
} from "./host-hook.js";

export type WorkbuddyHookEvent = HostHookEvent;
export type WorkbuddyHookInput = HostHookInput;
export type WorkbuddyHookResponse = HostHookResponse;
export type WorkbuddyHookServices = HostHookServices;
export type WorkbuddyHookInvocation = HostHookInvocation;
export type { TextInput } from "./host-hook.js";

export interface RunWorkbuddyHookOptions {
  readonly stdin: TextInput;
  readonly stdout: OutputWriter;
  readonly stderr: OutputWriter;
  readonly services?: WorkbuddyHookServices;
  readonly storeRoot?: string;
}

/** Detect the raw WorkBuddy Hook ABI and consume its only supported global option. */
export function parseWorkbuddyHookInvocation(
  arguments_: readonly string[],
): WorkbuddyHookInvocation | undefined {
  return parseHostHookInvocation(arguments_, "workbuddy");
}

/**
 * Execute the versioned raw WorkBuddy Hook ABI. It deliberately does not emit
 * the normal Lorelum CLI envelope: WorkBuddy consumes this envelope directly.
 */
export async function runWorkbuddyHook(options: RunWorkbuddyHookOptions): Promise<0> {
  return runHostHook({ ...options, host: "workbuddy" });
}

export async function createWorkbuddyHookResponse(
  input: WorkbuddyHookInput,
  services?: WorkbuddyHookServices,
  storeRoot?: string,
): Promise<WorkbuddyHookResponse> {
  return createHostHookResponse(input, "workbuddy", services, storeRoot);
}

export function buildWorkbuddyHookResponse(
  eventName: WorkbuddyHookEvent,
  details: ListPackDetailsResult,
): WorkbuddyHookResponse {
  return buildHostHookResponse(eventName, details);
}
