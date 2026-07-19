import { describe, expect, test } from "bun:test";

import { detectCycles } from "./cycle";

function graph(entries: [string, string[]][]): Map<string, string[]> {
  return new Map(entries);
}

describe("detectCycles", () => {
  test("empty graph has no cycles", () => {
    expect(detectCycles(graph([]))).toEqual([]);
  });

  test("acyclic chain A→B→C→D", () => {
    expect(
      detectCycles(
        graph([
          ["A", ["B"]],
          ["B", ["C"]],
          ["C", ["D"]],
          ["D", []],
        ]),
      ),
    ).toEqual([]);
  });

  test("self-loop A→A is a cycle", () => {
    const cycles = detectCycles(graph([["A", ["A"]]]));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["A", "A"]);
  });

  test("two-node cycle A→B→A", () => {
    const cycles = detectCycles(
      graph([
        ["A", ["B"]],
        ["B", ["A"]],
      ]),
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.[0]).toBe("A");
    expect(cycles[0]?.[1]).toBe("B");
  });

  test("three-node cycle A→B→C→A", () => {
    const cycles = detectCycles(
      graph([
        ["A", ["B"]],
        ["B", ["C"]],
        ["C", ["A"]],
      ]),
    );
    expect(cycles).toHaveLength(1);
    // members are A, B, C in traversal order, closing back to A
    expect(new Set(cycles[0])).toEqual(new Set(["A", "B", "C", "A"]));
  });

  test("two independent cycles are both reported", () => {
    const cycles = detectCycles(
      graph([
        ["A", ["B"]],
        ["B", ["A"]],
        ["C", ["D"]],
        ["D", ["C"]],
      ]),
    );
    expect(cycles).toHaveLength(2);
  });

  test("node with no outgoing edges (leaf) is fine", () => {
    expect(
      detectCycles(
        graph([
          ["A", ["B"]],
          ["B", []],
        ]),
      ),
    ).toEqual([]);
  });

  test("node not present as a key but referenced (dangling edge) is treated as a leaf", () => {
    // A→B where B has no entry; B is discovered as white leaf, no cycle.
    expect(detectCycles(graph([["A", ["B"]]]))).toEqual([]);
  });
});
