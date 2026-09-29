import { expect, test } from "bun:test";
import { listReleases } from "./release-client.js";

const target = "darwin-arm64";
function release(
  tag: string,
  options: { draft?: boolean; prerelease?: boolean; assets?: string[] } = {},
) {
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? tag.includes("-"),
    html_url: `https://github.com/lorelum/lorelum/releases/tag/${tag}`,
    assets: (options.assets ?? [`lore-${tag.slice(1)}-${target}.tar.gz`, "SHA256SUMS"]).map(
      (name) => ({ name }),
    ),
  };
}

test("reads every page and filters draft, mismatched channel and incomplete assets", async () => {
  const calls: string[] = [];
  const request = async (url: string | URL | Request) => {
    calls.push(String(url));
    if (calls.length === 1)
      return new Response(
        JSON.stringify([
          release("v0.1.0-alpha.3"),
          release("v0.1.0-alpha.9", { draft: true }),
          release("v0.1.0-alpha.8", { assets: ["SHA256SUMS"] }),
          release("junk"),
        ]),
        { headers: { link: '<https://api.github.com/page2>; rel="next"' } },
      );
    return new Response(
      JSON.stringify([release("v0.1.0-alpha.4"), release("v0.1.0", { prerelease: false })]),
    );
  };
  expect((await listReleases("prerelease", target, request)).map((item) => item.version)).toEqual([
    "0.1.0-alpha.3",
    "0.1.0-alpha.4",
    "0.1.0",
  ]);
  expect(calls).toHaveLength(2);
  calls.length = 0;
  expect((await listReleases("stable", target, request)).map((item) => item.version)).toEqual([
    "0.1.0",
  ]);
});

test("never treats failed or malformed later pages as a complete check", async () => {
  for (const second of [new Response("limited", { status: 429 }), new Response("{}")]) {
    let page = 0;
    const request = async () =>
      ++page === 1
        ? new Response(JSON.stringify([release("v0.1.0-alpha.4")]), {
            headers: { link: '<https://api.github.com/page2>; rel="next"' },
          })
        : second;
    expect(listReleases("prerelease", target, request)).rejects.toThrow();
  }
  expect(
    listReleases("prerelease", target, async () => {
      throw new Error("proxy password=secret");
    }),
  ).rejects.toThrow();
  expect(
    listReleases(
      "prerelease",
      target,
      async () => new Response(JSON.stringify([{ tag_name: "v0.1.0", assets: [] }])),
    ),
  ).rejects.toThrow("invalid release metadata");
  expect(
    listReleases(
      "prerelease",
      target,
      async () =>
        new Response("[]", { headers: { link: '<https://invalid.example/page2>; rel="next"' } }),
    ),
  ).rejects.toThrow("invalid release pagination URL");
});
