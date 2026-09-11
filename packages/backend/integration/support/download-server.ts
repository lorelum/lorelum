/** Local Range server that deliberately disconnects the first transfer after 1 MiB. */
export function createInterruptedDownloadServer(modelPath: string) {
  const model = Bun.file(modelPath);
  const offsets: number[] = [];
  const interruptedBytes = 1024 * 1024;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const offset = Number(request.headers.get("range")?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
      offsets.push(offset);
      const headers = {
        "content-length": String(model.size - offset),
        "accept-ranges": "bytes",
        ...(offset ? { "content-range": `bytes ${offset}-${model.size - 1}/${model.size}` } : {}),
      };
      // Sending fewer bytes than Content-Length closes the response early without noisy thrown errors.
      if (offsets.length === 1) return new Response(model.slice(0, interruptedBytes), { headers });
      return new Response(model.slice(offset), { status: offset ? 206 : 200, headers });
    },
  });
  return {
    offsets,
    interruptedBytes,
    url: `http://127.0.0.1:${server.port}/model`,
    stop: () => server.stop(true),
  };
}
