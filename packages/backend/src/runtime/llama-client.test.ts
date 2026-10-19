import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { MAX_RESPONSE_BYTES } from "../protocol/constants";
import { createLlamaClient } from "./llama-client";

afterEach(() => mock.restore());
const vector = [1, ...Array<number>(383).fill(0)];
const secondVector = [0, 1, ...Array<number>(382).fill(0)];
const client = () => createLlamaClient(12345, "a".repeat(64), "test-alias");

test("native batches restore input order from response indices", async () => {
  const thirdVector = [0, 0, 1, ...Array<number>(381).fill(0)];
  const inputs = ["first", "  second\n", "third"];
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json({
      model: "test-alias",
      data: [
        { index: 2, embedding: thirdVector },
        { index: 0, embedding: vector },
        { index: 1, embedding: secondVector },
      ],
    }),
  );
  expect(await client().encodeBatch(inputs, AbortSignal.timeout(1000))).toEqual([
    vector,
    secondVector,
    thirdVector,
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("http://127.0.0.1:12345/v1/embeddings");
  expect(options).toMatchObject({ method: "POST", proxy: "", redirect: "error" });
  expect(JSON.parse(options!.body as string)).toEqual({ input: inputs, encoding_format: "float" });
});

test("native batches require exactly one in-range integer index for every input", async () => {
  const fetcher = spyOn(globalThis, "fetch");
  for (const indices of [
    [],
    [0],
    [0, 1, 2],
    [0, 0],
    [0, 2],
    [-1, 0],
    [0, 0.5],
    [0, "1"],
    [0, undefined],
  ]) {
    fetcher.mockResolvedValueOnce(
      Response.json({
        model: "test-alias",
        data: indices.map((index) => ({ index, embedding: vector })),
      }),
    );
    // eslint-disable-next-line no-await-in-loop
    await expect(
      client().encodeBatch(["first", "second"], AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      code: "embedding.failed",
    });
  }
});

test("one malformed vector rejects the entire native batch", async () => {
  const fetcher = spyOn(globalThis, "fetch");
  for (const embedding of [
    [1],
    Array<number>(383).fill(0),
    Array<number>(385).fill(0),
    Array<number>(384).fill(0),
    [2, ...vector.slice(1)],
    [null, ...vector.slice(1)],
    ["1", ...vector.slice(1)],
  ]) {
    fetcher.mockResolvedValueOnce(
      Response.json({
        model: "test-alias",
        data: [
          { index: 0, embedding: vector },
          { index: 1, embedding },
        ],
      }),
    );
    // eslint-disable-next-line no-await-in-loop
    await expect(
      client().encodeBatch(["first", "second"], AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      code: "embedding.failed",
    });
  }
  const nonfiniteBody =
    `{"model":"test-alias","data":[` +
    `{"index":0,"embedding":${JSON.stringify(vector)}},` +
    `{"index":1,"embedding":[1e309,${vector.slice(1).join(",")}]}]}`;
  fetcher.mockResolvedValueOnce(new Response(nonfiniteBody));
  await expect(
    client().encodeBatch(["first", "second"], AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({
    code: "embedding.failed",
  });
});

test("single-input and eight-input batches fit the existing bounded native response", async () => {
  const denseVector = Array<number>(384).fill(1 / Math.sqrt(384));
  const fetcher = spyOn(globalThis, "fetch");
  for (const count of [1, 8]) {
    const inputs = Array.from({ length: count }, (_, index) => `input ${index}`);
    fetcher.mockResolvedValueOnce(
      Response.json({
        model: "test-alias",
        data: inputs.map((_, index) => ({ index, embedding: denseVector })),
      }),
    );
    // eslint-disable-next-line no-await-in-loop
    expect(await client().encodeBatch(inputs, AbortSignal.timeout(1000))).toEqual(
      inputs.map(() => denseVector),
    );
  }
});

test("overlarge native body is cancelled and malformed JSON is not returned", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1).fill(32));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body));
  await expect(client().encodeBatch(["text"], AbortSignal.timeout(1000))).rejects.toMatchObject({
    code: "embedding.failed",
  });
  expect(cancelled).toBe(true);
  fetcher.mockResolvedValueOnce(new Response("{"));
  await expect(client().encodeBatch(["text"], AbortSignal.timeout(1000))).rejects.toMatchObject({
    code: "embedding.failed",
  });
});

test("readiness identity is a private model alias never sent in batch requests", async () => {
  const data = [
    { index: 0, embedding: vector },
    { index: 1, embedding: secondVector },
  ];
  const fetcher = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json({ model: "foreign", data }),
  );
  const owned = createLlamaClient(12345, "a".repeat(64), "private-alias");
  await expect(
    owned.encodeBatch(["first", "second"], AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({
    code: "embedding.failed",
  });
  expect(fetcher.mock.calls[0]![1]!.body).not.toContain("private-alias");
  fetcher.mockResolvedValueOnce(Response.json({ model: "private-alias", data }));
  expect(await owned.encodeBatch(["first", "second"], AbortSignal.timeout(1000))).toEqual([
    vector,
    secondVector,
  ]);
});

test("a cancelled native batch retains its deadline error", async () => {
  const controller = new AbortController();
  controller.abort();
  spyOn(globalThis, "fetch").mockRejectedValueOnce(controller.signal.reason);
  await expect(client().encodeBatch(["first", "second"], controller.signal)).rejects.toMatchObject({
    code: "embedding.deadline-exceeded",
  });
});
