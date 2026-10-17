import type { HookEndpoint, HookIO } from "./types.js";

/** Native protocols share transport, not event names or response envelopes. */
export async function runHook(endpoint: HookEndpoint, io: HookIO): Promise<0> {
  let payload: unknown;
  try {
    const serialized = await io.stdin.text();
    const byteLength = Buffer.byteLength(serialized);
    try {
      payload = JSON.parse(serialized);
    } catch {
      io.log?.debug("hook.payload.invalid", { byteLength });
      throw new Error(`Lorelum ${endpoint.label} Hook input must be valid JSON.`);
    }
    const response = await endpoint.handle(payload, { byteLength });
    io.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    io.log?.error("hook.degraded", { host: io.host }, error);
    io.stderr.write(
      `lore hook ${io.host} degraded: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    io.stdout.write(`${JSON.stringify(endpoint.fallback(payload))}\n`);
  }
  return 0;
}
