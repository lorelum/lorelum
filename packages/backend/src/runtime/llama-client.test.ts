import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { createLlamaClient } from "./llama-client";

afterEach(() => mock.restore());
const vector = [1, ...Array<number>(383).fill(0)];
const client = () => createLlamaClient(12345, "a".repeat(64), "test-alias");

test("native vectors must be unique index zero, finite, 384 dimensions and normalized", async () => {
  const fetcher = spyOn(globalThis, "fetch");
  for (const data of [
    [],
    [{ index: 1, embedding: vector }],
    [
      { index: 0, embedding: vector },
      { index: 0, embedding: vector },
    ],
    [{ index: 0, embedding: [1] }],
    [{ index: 0, embedding: Array(384).fill(0) }],
    [{ index: 0, embedding: [null, ...vector.slice(1)] }],
  ]) {
    fetcher.mockResolvedValueOnce(Response.json({ model: "test-alias", data }));
    // eslint-disable-next-line no-await-in-loop
    await expect(client().encode("text", AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "embedding.failed",
    });
  }
  fetcher.mockResolvedValueOnce(
    Response.json({ model: "test-alias", data: [{ index: 0, embedding: vector }] }),
  );
  expect(await client().encode("text", AbortSignal.timeout(1000))).toEqual(vector);
  const [url, options] = fetcher.mock.calls.at(-1)!;
  expect(url).toBe("http://127.0.0.1:12345/v1/embeddings");
  expect(options).toMatchObject({ proxy: "", redirect: "error" });
});

test("overlarge native body is cancelled and malformed JSON is not returned", async () => {
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(" ".repeat(1_048_577)),
  );
  await expect(client().encode("text", AbortSignal.timeout(1000))).rejects.toMatchObject({
    code: "embedding.failed",
  });
  fetcher.mockResolvedValueOnce(new Response("{"));
  await expect(client().encode("text", AbortSignal.timeout(1000))).rejects.toMatchObject({
    code: "embedding.failed",
  });
});

test("readiness identity is a private model alias never sent in requests", async () => {
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json({ model: "foreign", data: [{ index: 0, embedding: vector }] }),
  );
  const owned = createLlamaClient(12345, "a".repeat(64), "private-alias");
  await expect(owned.encode("text", AbortSignal.timeout(1000))).rejects.toMatchObject({
    code: "embedding.failed",
  });
  expect(fetcher.mock.calls[0]![1]!.body).not.toContain("private-alias");
  fetcher.mockResolvedValueOnce(
    Response.json({ model: "private-alias", data: [{ index: 0, embedding: vector }] }),
  );
  expect(await owned.encode("text", AbortSignal.timeout(1000))).toEqual(vector);
});
