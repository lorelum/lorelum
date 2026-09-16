import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDescriptorRepository,
  gitRunnerMappingLocators,
  removeDescriptorRepository,
} from "./git-test-support.js";
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

const RAW_UNAVAILABLE_MESSAGE = "The Pack Registry is unavailable.";
const GIT_UNAVAILABLE_MESSAGE =
  "The Pack Registry is unavailable. Verify your SSH access to the repository " +
  "(e.g. `ssh -T git@github.com`), then retry.";
const SSH_LOCATOR = "git@github.com:acme/team-packs.git";
const SSH_URL_LOCATOR = "ssh://git@github.com/acme/team-packs.git";

function responseFetch(response: Response): typeof fetch {
  return (() => Promise.resolve(response)) as unknown as typeof fetch;
}

function fetchMustNotRun(): typeof fetch {
  return (() => {
    throw new Error("raw descriptor fetch must not run for git transport");
  }) as unknown as typeof fetch;
}

function gitMustNotRun() {
  return () => Promise.reject(new Error("git transport must not run for legacy locators"));
}

test("uses the built-in official Registry repository", () => {
  expect(resolveRegistryRepository()).toEqual({
    slug: "lorelum/lorelum-packs",
    gitUrl: "https://github.com/lorelum/lorelum-packs.git",
    descriptorUrl:
      "https://raw.githubusercontent.com/lorelum/lorelum-packs/HEAD/.lorelum/registry.yaml",
    transport: "raw",
  });
});

test("normalizes an explicit GitHub Registry repository", async () => {
  const loaded = await loadRegistry(
    "https://github.com/acme/team-packs.git",
    responseFetch(new Response(validRegistry)),
  );
  expect(loaded.repository.slug).toBe("acme/team-packs");
  expect(loaded.repository.transport).toBe("raw");
  expect(loaded.repository.gitUrl).toBe("https://github.com/acme/team-packs.git");
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

test("resolves SSH locators to the user-authenticated git transport", () => {
  const scp = resolveRegistryRepository(SSH_LOCATOR);
  expect(scp.slug).toBe("acme/team-packs");
  expect(scp.gitUrl).toBe(SSH_LOCATOR);
  expect(scp.transport).toBe("git");

  const url = resolveRegistryRepository(SSH_URL_LOCATOR);
  expect(url.slug).toBe("acme/team-packs");
  expect(url.gitUrl).toBe(SSH_URL_LOCATOR);
  expect(url.transport).toBe("git");

  const withoutSuffix = resolveRegistryRepository("git@github.com:acme/team-packs");
  expect(withoutSuffix.slug).toBe("acme/team-packs");
  expect(withoutSuffix.transport).toBe("git");
});

test.each([
  { name: "a non-github ssh host", locator: "git@gitlab.com:acme/packs.git" },
  { name: "a non-github ssh URL host", locator: "ssh://git@gitlab.com/acme/packs.git" },
  { name: "a non-git ssh username", locator: "ssh://user@github.com/acme/packs.git" },
  { name: "an explicit ssh port", locator: "ssh://git@github.com:22/acme/packs.git" },
  { name: "an ssh locator without a repository", locator: "git@github.com:acme" },
  { name: "an ssh locator with extra path segments", locator: "git@github.com:acme/packs/extra" },
  { name: "an ssh URL with extra path segments", locator: "ssh://git@github.com/acme/packs/extra" },
  { name: "a repository-less ssh URL", locator: "ssh://git@github.com/acme" },
])("rejects $name", ({ locator }) => {
  expect(() => resolveRegistryRepository(locator)).toThrow(
    /valid GitHub repository|owner\/repository/,
  );
});

test("rejects credentialed locator forms outright", () => {
  expect(() => resolveRegistryRepository("https://git:token@github.com/acme/packs.git")).toThrow(
    "valid GitHub repository",
  );
  expect(() => resolveRegistryRepository("ssh://git:pass@github.com/acme/packs.git")).toThrow(
    "valid GitHub repository",
  );
});

test("never retries legacy locators over git transport when raw fails", async () => {
  await expect(
    loadRegistry(
      "acme/team-packs",
      responseFetch(new Response("missing", { status: 404 })),
      gitMustNotRun(),
    ),
  ).rejects.toMatchObject({ code: "registry.unavailable", message: RAW_UNAVAILABLE_MESSAGE });
});

test("normalizes ssh:// dot segments consistently between slug and git URL", () => {
  const resolved = resolveRegistryRepository("ssh://git@github.com/acme/../evil/repo.git");
  expect(resolved.slug).toBe("evil/repo");
  expect(resolved.gitUrl).toBe("ssh://git@github.com/evil/repo.git");
  expect(resolved.transport).toBe("git");
});

test("accepts case-insensitive github.com hosts in scp-style locators", () => {
  const resolved = resolveRegistryRepository("git@GitHub.com:acme/team-packs.git");
  expect(resolved.slug).toBe("acme/team-packs");
  expect(resolved.gitUrl).toBe("git@GitHub.com:acme/team-packs.git");
  expect(resolved.transport).toBe("git");
});

test("distinguishes invalid content from an unavailable Registry", async () => {
  await expect(
    loadRegistry(undefined, responseFetch(new Response("schema_version: 2", { status: 200 }))),
  ).rejects.toMatchObject({ code: "registry.invalid" });
  await expect(
    loadRegistry(undefined, responseFetch(new Response("missing", { status: 404 }))),
  ).rejects.toMatchObject({
    code: "registry.unavailable",
    message: RAW_UNAVAILABLE_MESSAGE,
  });
});

test("keeps slug locators on the anonymous raw transport", async () => {
  const loaded = await loadRegistry(
    "acme/team-packs",
    responseFetch(new Response(validRegistry)),
    gitMustNotRun(),
  );
  expect(loaded.repository.transport).toBe("raw");
  expect(loaded.registry.packs[0]?.name).toBe("agentic-coding");
});

test("reads the descriptor over git transport from a local repository", async () => {
  const fixture = await createDescriptorRepository(validRegistry);
  try {
    const loaded = await loadRegistry(
      SSH_LOCATOR,
      fetchMustNotRun(),
      gitRunnerMappingLocators({ [SSH_LOCATOR]: fixture.fileUrl }),
    );
    expect(loaded.repository).toMatchObject({ slug: "acme/team-packs", transport: "git" });
    expect(loaded.registry.packs[0]?.name).toBe("agentic-coding");
  } finally {
    await removeDescriptorRepository(fixture);
  }
});

test("reads ssh:// locators through the same git transport", async () => {
  const fixture = await createDescriptorRepository(validRegistry);
  try {
    const loaded = await loadRegistry(
      SSH_URL_LOCATOR,
      fetchMustNotRun(),
      gitRunnerMappingLocators({ [SSH_URL_LOCATOR]: fixture.fileUrl }),
    );
    expect(loaded.repository.slug).toBe("acme/team-packs");
    expect(loaded.registry.packs[0]?.name).toBe("agentic-coding");
  } finally {
    await removeDescriptorRepository(fixture);
  }
});

test("maps a missing descriptor over git transport to an actionable unavailable error", async () => {
  const fixture = await createDescriptorRepository();
  try {
    await expect(
      loadRegistry(
        SSH_LOCATOR,
        fetchMustNotRun(),
        gitRunnerMappingLocators({ [SSH_LOCATOR]: fixture.fileUrl }),
      ),
    ).rejects.toMatchObject({
      code: "registry.unavailable",
      message: GIT_UNAVAILABLE_MESSAGE,
    });
  } finally {
    await removeDescriptorRepository(fixture);
  }
});

test("maps an unreachable repository to the same unavailable classification", async () => {
  await expect(
    loadRegistry(
      SSH_LOCATOR,
      fetchMustNotRun(),
      gitRunnerMappingLocators({
        [SSH_LOCATOR]: join(tmpdir(), "lorelum-nonexistent-repository"),
      }),
    ),
  ).rejects.toMatchObject({ code: "registry.unavailable", message: GIT_UNAVAILABLE_MESSAGE });
});

test("maps an oversized descriptor over git transport to registry.invalid", async () => {
  const oversized = `# ${"x".repeat(256 * 1024)}\n`;
  const fixture = await createDescriptorRepository(oversized);
  try {
    await expect(
      loadRegistry(
        SSH_LOCATOR,
        fetchMustNotRun(),
        gitRunnerMappingLocators({ [SSH_LOCATOR]: fixture.fileUrl }),
      ),
    ).rejects.toMatchObject({ code: "registry.invalid" });
  } finally {
    await removeDescriptorRepository(fixture);
  }
});

test("maps malformed descriptor content over git transport to registry.invalid", async () => {
  const fixture = await createDescriptorRepository("schema_version: 2");
  try {
    await expect(
      loadRegistry(
        SSH_LOCATOR,
        fetchMustNotRun(),
        gitRunnerMappingLocators({ [SSH_LOCATOR]: fixture.fileUrl }),
      ),
    ).rejects.toMatchObject({ code: "registry.invalid" });
  } finally {
    await removeDescriptorRepository(fixture);
  }
});
