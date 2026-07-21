/**
 * Cycle detection over a directed graph — three-colour DFS.
 *
 * Lives in its own file because it is a pure graph algorithm with no
 * dependency on the Practice/Decision schemas; validate.ts builds the edge
 * map and converts the returned cycles into validation issues.
 *
 * Three-colour DFS is chosen over Kahn's algorithm because the moment we
 * step onto a grey node, the current recursion stack *is* the cycle, so we
 * get the cycle members for free. Kahn only tells you "cycles exist", not
 * which nodes are on them.
 */

// Three-colour DFS. A node absent from `color` is implicitly WHITE (unvisited);
// only GRAY (on the current recursion stack) and BLACK (fully explored) are set.
const GRAY = 1;
const BLACK = 2;

/**
 * @param edges Adjacency map: node id → ids it points to. Missing keys are
 *   treated as leaves (no outgoing edges).
 * @returns One array per detected cycle, each listing the node ids on it
 *   in traversal order (e.g. ["A","B","C"] means A→B→C→A). Empty when the
 *   graph is acyclic.
 */
export function detectCycles(edges: Map<string, string[]>): string[][] {
  const color = new Map<string, number>();
  const path: string[] = [];
  const cycles: string[][] = [];

  function visit(node: string): void {
    color.set(node, GRAY);
    path.push(node);

    const targets = edges.get(node);
    if (targets) {
      for (const target of targets) {
        const targetColor = color.get(target);
        if (targetColor === GRAY) {
          // Stepped onto a node already on the current path → cycle.
          // Slice from where it first appeared on the stack.
          const start = path.indexOf(target);
          cycles.push([...path.slice(start), target]);
        } else if (targetColor === undefined) {
          visit(target);
        }
        // BLACK → fully explored, skip.
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  // Start DFS from every node so disconnected components are covered.
  for (const start of edges.keys()) {
    if (color.get(start) === undefined) {
      visit(start);
    }
  }

  return cycles;
}
