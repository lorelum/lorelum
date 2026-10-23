import type { SessionRef } from "@lorelum/backend/client";
import type { JsonValue, OutputWriter } from "../output/protocol.js";
import type { Logger } from "@lorelum/log";

export type HookHost = "codex" | "claude" | "cursor" | "workbuddy" | "zcode" | "omp";
export type JsonObject = Extract<JsonValue, Readonly<Record<string, unknown>>>;

export interface TextInput {
  text(): Promise<string>;
}

export interface CatalogReader {
  readCatalog(): Promise<string>;
}

export interface AutoUpdatePoller {
  poll(deliver: boolean): Promise<string | undefined>;
}

export interface ShellAssociator {
  associateShell(input: {
    readonly session: SessionRef;
    readonly command: string;
    readonly syntax: "posix" | "powershell";
  }): Promise<string | undefined>;
}

export interface ReadHintReader {
  readHintContext(session: SessionRef): Promise<string | undefined>;
}

/** A protocol boundary, not a common host lifecycle. */
export interface HookEndpoint {
  readonly label: string;
  handle(payload: unknown, context: { readonly byteLength: number }): Promise<JsonObject>;
  fallback(payload: unknown): JsonObject;
}

export interface HookIO {
  readonly host: HookHost;
  readonly stdin: TextInput;
  readonly stdout: OutputWriter;
  readonly stderr: OutputWriter;
  readonly log?: Logger;
}
