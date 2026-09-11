/* eslint-disable no-await-in-loop -- Response chunks are ordered and bounded. */
/** Transport-only reader. Callers translate failures into their own domain errors. */
export async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Missing response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("Response body exceeds its limit");
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } finally {
    reader.releaseLock();
  }
}
