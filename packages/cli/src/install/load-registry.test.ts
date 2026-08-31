import { expect, test } from "bun:test";

import { loadRegistry, resolveRegistryRepository } from "./load-registry.js";

const validRegistry = `schema_version: 1
name: lorelum-official
packs:
  - name: agentic-coding
    releases:
      - version: 0.1.0
        ref: agentic-coding-v0.1.0
        path: packs/agentic-coding
`;

function responseFetch(response: Response): typeof fetch {
  return (() => Promise.resolve(response)) as unknown as typeof fetch;
}

test("uses the built-in official Registry repository", () => {
  expect(resolveRegistryRepository()).toEqual({
    slug: "lorelum/lorelum-packs",
    gitUrl: "https://github.com/lorelum/lorelum-packs.git",
    descriptorUrl:
      "https://raw.githubusercontent.com/lorelum/lorelum-packs/HEAD/.lorelum/registry.yaml",
  });
});

test("normalizes an explicit GitHub Registry repository", async () => {
  const loaded = await loadRegistry(
    "https://github.com/acme/team-packs.git",
    responseFetch(new Response(validRegistry)),
  );
  expect(loaded.repository.slug).toBe("acme/team-packs");
  expect(loaded.registry.packs[0]?.name).toBe("agentic-coding");
});

test("rejects arbitrary Registry locators", () => {
  expect(() => resolveRegistryRepository("file:///tmp/packs")).toThrow("GitHub owner/repository");
  expect(() => resolveRegistryRepository("https://example.com/acme/packs")).toThrow(
    "valid GitHub repository",
  );
  expect(() => resolveRegistryRepository("https://github.com:444/acme/packs")).toThrow(
    "valid GitHub repository",
  );
});

test("distinguishes invalid content from an unavailable Registry", async () => {
  await expect(
    loadRegistry(undefined, responseFetch(new Response("schema_version: 2", { status: 200 }))),
  ).rejects.toMatchObject({ code: "registry.invalid" });
  await expect(
    loadRegistry(undefined, responseFetch(new Response("missing", { status: 404 }))),
  ).rejects.toMatchObject({ code: "registry.unavailable" });
});
