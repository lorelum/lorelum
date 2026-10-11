/**
 * The route layer's draft contract, driven rather than read.
 *
 * `blog-post-screen.test.ts` pins the two route files as text, and review round 6
 * measured what that can do: it accepted a route that reached the source through
 * another server module, a re-export, or a rebuilt registry — all of which serve a
 * draft in production while the whole suite stays green, and the prerendered
 * artifact stays clean too, because the crawler never visits a link that is not
 * there. This file drives the route modules instead, so that class fails here.
 *
 * How it runs them: the route module tests can import it at all only after its
 * three server-only dependencies are substituted — `content/registry.ts` (reaches
 * `fumadocs-mdx/macro`), `content/client.ts`, and `server/source.ts`. Both entry
 * points to the corpus get the same fixture-backed lookup, so a route that reads
 * the source for itself resolves the *draft* rather than nothing: a bypass fails
 * the refusal assertions here instead of quietly succeeding. The loader is then
 * called inside TanStack Start's own storage context, which is where the route's
 * server function executes.
 *
 * The environment is part of the fixture, not scenery, and it is set *before* the
 * route modules are imported — so a read at module scope captures the production
 * shape just as a bundler would bake it in. Three rounds of review produced this,
 * each time the same way: the model was narrower than a real build. The first
 * version only cleared `DEV`, so a bypass conditioned on `import.meta.env.PROD`
 * served a draft while the suite stayed green. The second set the environment per
 * test, so a module-scope `const IS_PROD = import.meta.env.PROD` captured
 * `undefined` at import time and stayed green for the same reason. The third had
 * four names but not the rest of what a bundler injects, and a bypass conditioned on
 * `import.meta.env.SSR` — true on the server this app renders on — was green too.
 * So the fixture now covers **every key a Vite build injects into
 * `import.meta.env`**, measured from this repository's own Vite rather than assumed:
 * `MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`. `NODE_ENV` is included as well, although
 * Vite leaves it `undefined` in `import.meta.env` — it is the server runtime's own
 * variable of that name, which the routes could read from `process.env`, so the
 * fixture sets it too (conservative: it can only make a leak *visible* here). The
 * refusal is required under every spelling of the environment, one test each, and
 * `setEnv` clears every modelled name before applying a spelling so each test runs in
 * the environment it names.
 *
 * What the harness cannot reproduce, stated as classes rather than examples:
 *
 * 1. **Values, yes; types, no.** A bundler substitutes `DEV`, `PROD` and `SSR` as
 *    booleans; under `bun test` `import.meta.env` is a view of `process.env`, so the
 *    closest available value is a string. A route that tested one strictly —
 *    `import.meta.env.PROD === true`, `import.meta.env.DEV === false` — would take
 *    the bypass branch in a real build and the refusal branch here, and this file
 *    cannot tell the difference.
 * 2. **The bundler's key set, not only its values.** A build's `import.meta.env` is a
 *    literal object with those five keys; under `bun test` it is a view of the whole
 *    process environment. So a name the runner inherited — `PATH`, `HOME`, `SHELL` —
 *    is *present* here and *absent* in a build, and a name the test has never heard
 *    of (`VITE_*`, anything custom) is absent here and unknowable to the test. A
 *    route conditioned on a name being **missing** therefore takes the bypass branch
 *    in a build and the refusal branch here. This is a boundary rather than an
 *    omission: the fixture cannot delete the runner's own environment without
 *    breaking the runner, and the set of names it does not know cannot be
 *    enumerated. Both directions are registered as mutation rows that are *expected*
 *    to pass, so the boundary is a reading rather than a claim.
 * 3. **The mirror of the import-time capture**: because the modules are imported
 *    once, in the production shape, a route that captured `DEV` at module scope is
 *    not exercised in its development shape — and would fail the development test
 *    below even though it behaves correctly in a real development build. That is a
 *    false-positive direction, not a leak.
 *
 * The observable contract here is the *refusal*: the client-role middleware
 * (`@tanstack/start-client-core` `createServerFn.js`) discards a handler's return
 * value when the handler is invoked uncompiled, and re-throws its errors. So a draft
 * must produce the app's own `notFound()`, a published post must not, and developing
 * must not either. `mock.module` is process-wide: a test file in this process that
 * imported the blog source adapter would receive the fake.
 *
 * **Both index routes are covered by an invariant rather than by their payload** —
 * `routes/blog/index.tsx` and `routes/$lang/blog/index.tsx`, which are structurally
 * identical. Their loaders' payload crosses the discarding boundary, so what they
 * *return* is not observable here; a review measured that by building an index route
 * which read the source itself and listed the draft, and the suite stayed green. But
 * *who read the corpus* is observable, because the adapter is this file's: the last
 * block asserts that every read comes from one of the three server modules that own
 * it, so a route reaching for the source itself now fails here — measured, at both
 * index routes. What stays out of reach is a route that produced a draft list without
 * reading the corpus at all, which is a different (and much stranger) defect.
 *
 * The sitemap route is held to the same standard, and there the whole response is
 * observable: its `GET` handler returns the document, so the assertions read the
 * draft slug's absence in the XML the crawler would receive rather than in the
 * function that produced it. Its docs source is substituted too, because the
 * sitemap composes both; the blog entries are what is asserted.
 */
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";

interface FakePage {
  readonly slug: string;
  readonly slugs: readonly string[];
  readonly path: string;
  readonly locale: string;
  /** The public path the source reports, as the sitemap reads it. */
  readonly url: string;
  readonly data: Record<string, unknown>;
}

/**
 * Published in both locales, plus a draft that exists in both and in neither
 * locale's shape is "draft": the slugs deliberately do not contain the word, so a
 * rule keyed on the slug would not pass.
 */
const page = (slug: string, locale: string, draft: boolean): FakePage => ({
  slug,
  slugs: [slug],
  path: `content/blog/${slug}.mdx`,
  locale,
  url: locale === "en" ? `/blog/${slug}` : `/${locale}/blog/${slug}`,
  data: {
    title: `Title of ${slug}`,
    description: `Description of ${slug}.`,
    date: "2026-09-18",
    category: "benchmark",
    author: "Someone",
    draft,
  },
});

const publishedEn = () => page("practice-notes", "en", false);
const publishedZh = () => page("practice-notes", "zh", false);
const draftEn = () => page("unfinished-notes", "en", true);
const draftZh = () => page("unfinished-notes", "zh", true);

/** Every case runs against the same corpus; only the environment varies. */
const PRODUCTION_CORPUS: readonly FakePage[] = [publishedEn(), publishedZh(), draftEn(), draftZh()];

const pages: FakePage[] = [];
const corpus = (...next: FakePage[]) => {
  pages.length = 0;
  pages.push(...next);
};

/**
 * Who read the corpus, and from where. Every read through this adapter is recorded
 * with its calling frames, so the tests below can assert the layer discipline the
 * route text pins only approximate: **only the three server modules that own the
 * corpus read it** (`list-blog-posts.ts`, `load-blog-post.ts`, `published-pages.ts`).
 * A route that reached for the source itself would appear as the direct caller, and
 * that is what makes this cover the two index routes, whose loader payload the
 * harness cannot observe.
 */
interface SourceRead {
  readonly call: "getPages" | "getPage";
  /** Stack frames, innermost first, with this file's own frames filtered out. */
  readonly frames: string[];
}

const reads: SourceRead[] = [];

const callerFrames = () => {
  const stack = new Error().stack ?? "";
  return stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/^at\s+/, ""))
    .filter((line) => !line.includes("route-draft-visibility.test.ts"))
    .filter((line) => !/^node:|^bun:/.test(line));
};

/** The module that called the adapter, as `name file:line`, or "unattributed". */
const readerOf = (read: SourceRead) => read.frames[0] ?? "unattributed";

const lookup = () => ({
  getPages: () => {
    reads.push({ call: "getPages", frames: callerFrames() });
    return pages;
  },
  getPage: (slugs: readonly string[], lang?: string) => {
    reads.push({ call: "getPage", frames: callerFrames() });
    return pages.find(
      (candidate) =>
        candidate.slugs.join("/") === slugs.join("/") &&
        (lang === undefined || lang === candidate.locale),
    );
  },
});

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * The environment, defined before anything is imported. `import.meta.env` is a live
 * view of `process.env` under `bun test` (verified for every name below), so setting
 * the production shape here means a route that captured it at module scope — the
 * shape a bundler bakes in — captures the production shape too, instead of whatever
 * the test process happened to start with. The names below are exactly the ones this
 * file manipulates; `setEnv` clears all of them before applying a spelling, so each
 * spelling test runs in the environment it names rather than in a superset left over
 * from the previous one.
 */
const ENVIRONMENT_KEYS = ["DEV", "PROD", "MODE", "NODE_ENV", "SSR", "BASE_URL"] as const;

type Environment = Record<string, string | undefined>;

/**
 * Two names a server render always has, whatever else is set: the app's routes run
 * on the server (SSR and during prerender), and a build injects both. A fixture that
 * left `SSR` unset would model a *client* render, which is not where these routes
 * read a draft — and a review measured a bypass conditioned on `import.meta.env.SSR`
 * staying green while a real server render would have served the draft.
 */
const SERVER_BUILTINS: Environment = { SSR: "1", BASE_URL: "/" };

/** The shape a Vite production build substitutes into `import.meta.env`. */
const PRODUCTION: Environment = {
  ...SERVER_BUILTINS,
  DEV: undefined,
  PROD: "1",
  MODE: "production",
  NODE_ENV: "production",
};
/** …and the development one, which is also a server render. */
const DEVELOPMENT: Environment = {
  ...SERVER_BUILTINS,
  DEV: "1",
  PROD: undefined,
  MODE: "development",
  NODE_ENV: "development",
};

const setEnv = (environment: Environment) => {
  for (const key of ENVIRONMENT_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) process.env[key] = value;
  }
};

const ORIGINAL_ENV: Environment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
);

setEnv(PRODUCTION);

mock.module(here("./server/source.ts"), () => ({ blogSource: lookup() }));
mock.module(here("./content/registry.ts"), () => ({
  // A route that rebuilds its own loader from the registry gets the same corpus,
  // so reaching the source another way cannot dodge the assertions below.
  blog: { toFumadocsSource: () => ({ files: () => [], ...lookup() }) },
}));
mock.module(here("./content/client.ts"), () => ({
  loadBlogContent: async () => ({ default: () => null, toc: [] }),
  preloadBlogContent: async () => undefined,
}));
// The sitemap composes the docs source with the blog's. Substituting the docs
// side keeps the document realistic without dragging in the docs registry.
mock.module(here("../docs/server/source.ts"), () => ({
  source: { getPages: () => [{ url: "/docs", data: {} }] },
  getLLMText: async () => "",
}));

interface RouteLike {
  readonly options: {
    readonly loader: (input: { params: Record<string, string> }) => Promise<unknown>;
  };
}

const enRoute = (
  (await import(pathToFileURL(here("../../routes/blog/$slug.tsx")).href)) as {
    Route: RouteLike;
  }
).Route;
const langRoute = (
  (await import(pathToFileURL(here("../../routes/$lang/blog/$slug.tsx")).href)) as {
    Route: RouteLike;
  }
).Route;

const sitemapRoute = (
  (await import(pathToFileURL(here("../../routes/sitemap[.]xml.ts")).href)) as {
    Route: { options: { server: { handlers: { GET: () => Promise<Response> } } } };
  }
).Route;

/**
 * The two index routes. Their loaders call a server function whose return value the
 * harness cannot see (see the file header), so they are covered by the invariant
 * below rather than by a payload assertion: whatever they decide, they must decide it
 * without reading the corpus themselves.
 */
interface IndexRouteLike {
  readonly options: {
    readonly loader: (input: { deps: { category?: string }; params: unknown }) => Promise<unknown>;
  };
}

const indexRoute = (
  (await import(pathToFileURL(here("../../routes/blog/index.tsx")).href)) as {
    Route: IndexRouteLike;
  }
).Route;
const langIndexRoute = (
  (await import(pathToFileURL(here("../../routes/$lang/blog/index.tsx")).href)) as {
    Route: IndexRouteLike;
  }
).Route;

const START_CONTEXT = Symbol.for("tanstack-start:start-storage-context");
const storage = (globalThis as Record<PropertyKey, unknown>)[START_CONTEXT] as
  | { run: <T>(context: unknown, fn: () => T) => T }
  | undefined;

const requestContext = () => ({
  request: new Request("http://localhost/blog/x"),
  response: new Response(),
  router: {},
});

/** What the router itself reads to turn a thrown value into a 404. */
const isRefusal = (error: unknown) =>
  (error as { isNotFound?: boolean } | null)?.isNotFound === true;

/**
 * Other ways the same thing gets spelled. `PROD` truthiness and `NODE_ENV` are both
 * live in the bundle and a route could read either; the server builtins stay set
 * throughout, because a server render has them whatever else is true; and the bare
 * environment is the one `bun test` starts in, which the first version of this file
 * mistakenly treated as "production". Each is its own test, so a regression against
 * one spelling names that spelling — and because `setEnv` clears every modelled name
 * first, each really runs in the environment it names.
 */
const PRODUCTION_SPELLINGS: readonly [string, Environment][] = [
  ["a production build spelled the way the bundler spells it", PRODUCTION],
  ["a build whose only production signal is PROD", { ...SERVER_BUILTINS, PROD: "true" }],
  [
    "a build whose only production signal is NODE_ENV",
    { ...SERVER_BUILTINS, NODE_ENV: "production" },
  ],
  ["a build whose only production signal is MODE", { ...SERVER_BUILTINS, MODE: "production" }],
  ["a server render whose only signal is SSR", SERVER_BUILTINS],
  ["an environment with nothing set", {}],
];

/**
 * Drives the route the way a request does, and reports only the contract that
 * survives this boundary: whether the route refused. The value a successful
 * handler returns is not delivered to the caller in this version (see the file
 * header), so it is reported but not asserted on.
 */
const drive = async (route: RouteLike, params: Record<string, string>) => {
  try {
    const value = await storage!.run(requestContext(), () => route.options.loader({ params }));
    return { refused: false, value };
  } catch (error) {
    return { refused: isRefusal(error), value: error };
  }
};

afterEach(() => {
  pages.length = 0;
  setEnv(PRODUCTION);
});

// The file set the production shape at import time, before anything else ran, so it
// puts the process back the way it found it rather than leaving a fake environment
// behind for whatever runs next in this process.
afterAll(() => {
  setEnv(ORIGINAL_ENV);
});

describe("the blog route refuses a draft in a production build", () => {
  test("the Start context is present, so these tests are driving something", () => {
    // Without it every case would throw the same "No Start context" error and the
    // refusal assertions would fail loudly rather than pass quietly — but the
    // guard makes that explicit instead of implied.
    expect(typeof storage?.run).toBe("function");
  });

  test("an unprefixed article URL does not hand the reader a draft", async () => {
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);

    expect(await drive(enRoute, { slug: "unfinished-notes" })).toMatchObject({
      refused: true,
    });
  });

  // The attack this closes: a bypass conditioned on `import.meta.env.PROD` served a
  // draft in a real build while an earlier version of this file — which only cleared
  // `DEV` — stayed green, because `PROD` is undefined under `bun test` and true in a
  // build. The refusal is required for every spelling, not the one the harness
  // happens to start in.
  for (const [name, environment] of PRODUCTION_SPELLINGS) {
    test(`a draft is refused in ${name}`, async () => {
      corpus(...PRODUCTION_CORPUS);
      setEnv(environment);

      expect(await drive(enRoute, { slug: "unfinished-notes" })).toMatchObject({
        refused: true,
      });
      expect(await drive(langRoute, { lang: "zh", slug: "unfinished-notes" })).toMatchObject({
        refused: true,
      });
    });
  }

  test("a prefixed article URL does not hand the reader a draft either", async () => {
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);

    // Both locales: keyed on the locale prefix the draft is refused in each.
    expect(await drive(langRoute, { lang: "zh", slug: "unfinished-notes" })).toMatchObject({
      refused: true,
    });
    expect(await drive(langRoute, { lang: "en", slug: "unfinished-notes" })).toMatchObject({
      refused: true,
    });
  });

  test("a published post is not refused, so the refusal above is the draft rule", async () => {
    // The fixture is the same in every case; only `draft` and the slug differ. If
    // the source substitution silently failed, every slug would be unknown and
    // this case would refuse too.
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);

    expect(await drive(enRoute, { slug: "practice-notes" })).toMatchObject({ refused: false });
    expect(await drive(langRoute, { lang: "zh", slug: "practice-notes" })).toMatchObject({
      refused: false,
    });
    expect(await drive(langRoute, { lang: "en", slug: "practice-notes" })).toMatchObject({
      refused: false,
    });
  });

  test("a slug that exists nowhere is refused, as it was before the rule", async () => {
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);

    expect(await drive(enRoute, { slug: "no-such-post" })).toMatchObject({ refused: true });
    expect(await drive(langRoute, { lang: "zh", slug: "no-such-post" })).toMatchObject({
      refused: true,
    });
  });

  test("an unsupported locale prefix is refused before the corpus is consulted", async () => {
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);

    expect(await drive(langRoute, { lang: "de", slug: "practice-notes" })).toMatchObject({
      refused: true,
    });
  });
});

describe("while developing, the route serves the draft it cannot serve in a build", () => {
  test("the same URL that was refused in production is not refused here", async () => {
    // This is the other half of the rule the article URL and the index share: the
    // author reaches the page they are writing, and nowhere else does.
    corpus(...PRODUCTION_CORPUS);
    setEnv(DEVELOPMENT);

    expect(await drive(enRoute, { slug: "unfinished-notes" })).toMatchObject({ refused: false });
    expect(await drive(langRoute, { lang: "zh", slug: "unfinished-notes" })).toMatchObject({
      refused: false,
    });
  });
});

describe("the sitemap the crawler receives", () => {
  const locations = async () => {
    const response = await sitemapRoute.options.server.handlers.GET();
    const body = await response.text();
    return {
      status: response.status,
      body,
      locs: [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    };
  };

  test("lists a published post in both locales and no draft", async () => {
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);

    const { status, body, locs } = await locations();

    expect(status).toBe(200);
    // Both spellings, including the prefixed one, so "canonical only" and
    // "default locale only" would each be caught.
    expect(locs).toContain("https://lorelum.com/blog/practice-notes");
    expect(locs).toContain("https://lorelum.com/zh/blog/practice-notes");
    // The index entries are the positive control: if the blog half of the
    // sitemap stopped contributing at all, the two assertions above would fail
    // but so would these, and the emptiness would be attributed correctly.
    expect(locs).toContain("https://lorelum.com/blog");
    expect(locs).toContain("https://lorelum.com/zh/blog");
    expect(body).not.toContain("unfinished-notes");
  });

  test("a draft is absent while developing too, because a sitemap is not a preview", async () => {
    // The loader's rule is environment-dependent; the sitemap's is not, and this
    // is the assertion that keeps the two from being conflated.
    corpus(...PRODUCTION_CORPUS);
    setEnv(DEVELOPMENT);

    const { body, locs } = await locations();

    expect(locs).toContain("https://lorelum.com/blog/practice-notes");
    expect(body).not.toContain("unfinished-notes");
  });
});

/**
 * The layer discipline behind every visibility rule above: whatever a route decides,
 * it must decide it without reading the corpus itself. That is the invariant the
 * route text pins in `blog-post-screen.test.ts` approximate, and it is the one the
 * two index routes can be held to — their loader payload is not observable here, but
 * *who read the source* is, because the adapter is this file's.
 *
 * The boundary: a read is attributed by its calling stack, so a route that reached
 * the corpus through some mechanism that never touches the substituted modules is
 * still out of reach (the same boundary the file header states). What it does cover
 * is the realistic path — a route importing the source adapter, or anything that
 * forwards it, which is how the bypasses that survived the text pins were built.
 */
describe("no route reads the blog corpus for itself", () => {
  /** The three modules that own the corpus; a read from anywhere else is a leak. */
  const OWNERS = ["list-blog-posts.ts", "load-blog-post.ts", "published-pages.ts"];

  const driveIndex = (route: IndexRouteLike, lang: string) =>
    storage!.run(requestContext(), () =>
      route.options.loader({ deps: { category: undefined }, params: { lang } }),
    );

  const readersOf = () => reads.map((read) => readerOf(read));

  test("the unprefixed index route asks a server module, and never the source", async () => {
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);
    reads.length = 0;

    await driveIndex(indexRoute, "en");

    expect(readersOf().length).toBeGreaterThan(0);
    for (const reader of readersOf()) {
      expect({ reader, owner: OWNERS.some((owner) => reader.includes(owner)) }).toMatchObject({
        owner: true,
      });
    }
  });

  test("the prefixed index route asks a server module, and never the source", async () => {
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);
    reads.length = 0;

    await driveIndex(langIndexRoute, "zh");

    expect(readersOf().length).toBeGreaterThan(0);
    for (const reader of readersOf()) {
      expect({ reader, owner: OWNERS.some((owner) => reader.includes(owner)) }).toMatchObject({
        owner: true,
      });
    }
  });

  test("both article routes and the sitemap obey the same rule", async () => {
    // The article routes are asserted behaviourally above; this adds the provenance
    // dimension, so a route that refused correctly *and* read the source itself
    // would still be caught.
    corpus(...PRODUCTION_CORPUS);
    setEnv(PRODUCTION);
    reads.length = 0;

    await drive(enRoute, { slug: "practice-notes" });
    await drive(langRoute, { lang: "zh", slug: "practice-notes" });
    await sitemapRoute.options.server.handlers.GET();

    expect(readersOf().length).toBeGreaterThan(0);
    for (const reader of readersOf()) {
      expect({ reader, owner: OWNERS.some((owner) => reader.includes(owner)) }).toMatchObject({
        owner: true,
      });
    }
  });
});
