import { expect, test } from "bun:test";
import { BackendError, EmbeddingError, type BuildInfo } from "@lorelum/backend/protocol";
import { backendCliError } from "./error";
import { renderResult } from "../output/render";
import { ConfigError } from "@lorelum/config";
import { configurationFailureFrom } from "../runtime/config-failure";

const build: BuildInfo = {
  toolVersion: "0.1.0-test",
  buildIdentity: "current-build-identity",
  revision: "0123456789abcdef0123456789abcdef01234567",
  dirty: true,
  buildKind: "compiled",
};

test("protocol mismatch adds local provenance without losing remote guidance", async () => {
  const message = `${new BackendError("backend.protocol-mismatch").message} Backend: version unknown, build ${"a".repeat(64)}, Backend protocol 3.`;
  const result = await backendCliError(
    new BackendError("backend.protocol-mismatch", undefined, message),
    build,
  );
  expect(result.code).toBe("backend.protocol-mismatch");
  expect(result.message).toContain(message);
  expect(result.message).toContain(build.buildIdentity);
  expect(result.message).toContain(`${build.revision} dirty`);
  expect(result.message).toContain(build.toolVersion);
  expect(result.message.length).toBeGreaterThan(400);
  for (const format of ["text", "json"] as const) {
    let output = "";
    renderResult(
      {
        write: (value) => {
          output += value;
        },
      },
      format,
      {
        kind: "failure",
        command: "backend.status",
        code: result.code,
        message: result.message,
      },
    );
    expect(output).toContain(result.message);
  }
});

test("ordinary backend errors keep their specific guidance", async () => {
  const error = new BackendError("backend.unauthorized");
  expect(await backendCliError(error)).toMatchObject({ code: error.code, message: error.message });
});

test("backend configuration mapping preserves the safe config cause", async () => {
  const cause = new ConfigError({
    kind: "document",
    source: { kind: "file", path: "/example/config.yaml" },
    reason: "yaml-syntax",
    location: { line: 2, column: 1 },
  });
  const mapped = await backendCliError(
    new BackendError("backend.config-invalid", { cause }, cause.message),
  );
  expect(mapped.cause).toBe(cause);
  expect(configurationFailureFrom(mapped)).toBe(cause.failure);
  expect(mapped.message).toBe(cause.message);
});

test("model resource errors survive the shared CLI mapping", async () => {
  const resource = {
    kind: "model" as const,
    file: "model.gguf",
    check: "missing" as const,
  };
  const error = new EmbeddingError("embedding.native-resource-invalid", undefined, resource);
  expect(await backendCliError(error)).toMatchObject({
    code: error.code,
    message: error.message,
    resource,
  });
});
