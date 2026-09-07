import { Database } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { StoreBusyError, type EffectivePractice } from "../local-store";
import { canonicalizePractice } from "../local-store/model";
import { InvalidQueryRequestError, KeywordIndexError } from "./errors";
import { createQueryService } from "./query-service";
import * as keywordIndex from "./keyword/keyword-index";

function entry(id = "example.react", title = "React authentication"): EffectivePractice {
  const canonical = canonicalizePractice({
    id,
    title,
    stage: "api",
    tech_stack: ["react"],
    applies_when: "React authentication",
    body: "Complete private-to-get guidance",
    severity: "warn",
  });
  return { practiceId: id, ...canonical, sources: [] };
}

test("one query reads one corpus and assembles summaries from the same snapshot", async () => {
  const practice = entry();
  const reads: string[] = [];
  const service = createQueryService({
    store: {
      async readEffectivePractices(root) {
        reads.push(root.rootPath);
        return [practice];
      },
    },
  });
  const result = await service.query({ rootPath: "/isolated/a" }, { text: "React" });
  expect(reads).toEqual(["/isolated/a"]);
  expect(result).toEqual({
    mode: "keyword",
    results: [
      {
        practiceId: practice.practiceId,
        title: practice.practice.title,
        stage: "api",
        techStack: ["react"],
        appliesWhen: "React authentication",
        severity: "warn",
        contentDigest: practice.contentDigest,
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("Complete private-to-get guidance");
  expect(Object.isFrozen(result.results)).toBe(true);
  expect(result.results[0]?.techStack).not.toBe(practice.practice.tech_stack);
});

test("invalid requests never read a Store", async () => {
  let reads = 0;
  const service = createQueryService({
    store: {
      async readEffectivePractices() {
        reads++;
        return [];
      },
    },
  });
  await expect(service.query({ rootPath: "/unused" }, { text: " " })).rejects.toBeInstanceOf(
    InvalidQueryRequestError,
  );
  await expect(
    service.query({ rootPath: "/unused" }, { text: "React", limit: 100 }),
  ).rejects.toBeInstanceOf(InvalidQueryRequestError);
  expect(reads).toBe(0);
});

test("default top-k and equal-score ordering are deterministic", async () => {
  const practices = [6, 5, 4, 3, 2, 1].map((id) => entry(`example.item${id}`, "same focus"));
  const service = createQueryService({
    store: {
      async readEffectivePractices() {
        return practices;
      },
    },
  });
  const result = await service.query({ rootPath: "/unused" }, { text: "focus" });
  expect(result.results.map((hit) => hit.practiceId)).toEqual([
    "example.item1",
    "example.item2",
    "example.item3",
    "example.item4",
    "example.item5",
  ]);
});

test("empty Stores, unmatched text, and tokenless text return successful empty results", async () => {
  for (const practices of [[], [entry()]]) {
    const service = createQueryService({
      store: {
        async readEffectivePractices() {
          return practices;
        },
      },
    });
    for (const text of ["zzznomatch", "!!!"]) {
      // eslint-disable-next-line no-await-in-loop -- check each request's independent result
      expect(await service.query({ rootPath: "/unused" }, { text })).toEqual({
        mode: "keyword",
        results: [],
      });
    }
  }
});

test("a shared service keeps concurrent roots and snapshots isolated", async () => {
  let releaseA!: (value: readonly EffectivePractice[]) => void;
  const waitingA = new Promise<readonly EffectivePractice[]>((resolve) => {
    releaseA = resolve;
  });
  const service = createQueryService({
    store: {
      async readEffectivePractices(root) {
        return root.rootPath === "/a" ? waitingA : [entry("example.b")];
      },
    },
  });
  const first = service.query({ rootPath: "/a" }, { text: "React" });
  const second = await service.query({ rootPath: "/b" }, { text: "React" });
  releaseA([entry("example.a")]);
  expect(second.results.map((hit) => hit.practiceId)).toEqual(["example.b"]);
  expect((await first).results.map((hit) => hit.practiceId)).toEqual(["example.a"]);
});

test("Store errors propagate without building an index or becoming an empty result", async () => {
  const error = new StoreBusyError("test busy");
  const close = spyOn(Database.prototype, "close");
  try {
    const service = createQueryService({
      store: {
        async readEffectivePractices() {
          throw error;
        },
      },
    });
    await expect(service.query({ rootPath: "/unused" }, { text: "React" })).rejects.toBe(error);
    expect(close).not.toHaveBeenCalled();
  } finally {
    close.mockRestore();
  }
});

test("QueryService closes its index on success and result-assembly failure", async () => {
  const practice = entry();
  let snapshot = [practice];
  const service = createQueryService({
    store: {
      async readEffectivePractices() {
        return snapshot;
      },
    },
  });
  const close = spyOn(Database.prototype, "close");
  try {
    await service.query({ rootPath: "/unused" }, { text: "React" });
    expect(close).toHaveBeenCalledTimes(1);
    snapshot = [{ ...practice, practice: { ...practice.practice, severity: undefined } }];
    await expect(service.query({ rootPath: "/unused" }, { text: "React" })).rejects.toBeInstanceOf(
      KeywordIndexError,
    );
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    close.mockRestore();
  }
});

test("QueryService closes its index when search fails", async () => {
  const failure = new KeywordIndexError("injected search failure");
  let closes = 0;
  const build = spyOn(keywordIndex, "buildKeywordIndex").mockImplementation(() => ({
    search() {
      throw failure;
    },
    close() {
      closes++;
    },
  }));
  try {
    const service = createQueryService({
      store: {
        async readEffectivePractices() {
          return [entry()];
        },
      },
    });
    await expect(service.query({ rootPath: "/unused" }, { text: "React" })).rejects.toBe(failure);
    expect(closes).toBe(1);
  } finally {
    build.mockRestore();
  }
});
