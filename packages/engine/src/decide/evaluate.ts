import type { DecisionBranch, DecisionNode } from "@lorelum/format";

import {
  ConditionSyntaxError,
  evaluateParsedCondition,
  parseCondition,
  type Expression,
} from "./when.js";
import {
  DecisionEvaluationError,
  decisionErrorCodes,
  type DecideResult,
  type DecisionEvaluationInput,
  type DecisionRecommendation,
  type DecisionTraceEntry,
} from "./types.js";

/**
 * Pure decision-graph evaluator (ADR 0008). `evaluateDecisions` walks one
 * deterministic path from the entry node: the first matching branch wins,
 * `next` chains continue to other Decision Nodes, cycles and unknown ids are
 * typed errors, and every step is recorded in the returned trace. The module
 * touches no filesystem or process I/O so the CLI and future MCP adapters
 * share exactly these semantics.
 */

/**
 * Evaluate one decision path in declaration order. The evaluator stays pure,
 * so the CLI and future MCP adapters share the same decision semantics.
 */
export function evaluateDecisions(input: DecisionEvaluationInput): DecideResult {
  // An empty decision list is a normal no_match (spec §2.2), not an error.
  if (input.decisions.length === 0) {
    return {
      entryDecision: input.entryDecision,
      noMatchReason: "pack has no decisions",
      recommendations: [],
      status: "no_match",
      trace: [],
    };
  }

  const decisionsById = new Map<string, DecisionNode>();
  // Build the id → node lookup table first; duplicate ids are rejected before evaluation for deterministic paths.
  for (const decision of input.decisions) {
    if (decisionsById.has(decision.id)) {
      throw new DecisionEvaluationError(
        decisionErrorCodes.duplicateDecision,
        "The decision graph contains duplicate decision ids.",
      );
    }
    decisionsById.set(decision.id, decision);
  }
  // Runtime state for one evaluation path: merged recommendations, audit trace, cycle-safe visited set.
  const recommendations = new Map<string, DecisionRecommendation>();
  const trace: DecisionTraceEntry[] = [];
  const visited = new Set<string>();
  let currentDecisionId = input.entryDecision;

  while (true) {
    // Defensive cycle detection: next edges only move forward, never back to a visited node.
    if (visited.has(currentDecisionId)) {
      throw new DecisionEvaluationError(
        decisionErrorCodes.cycle,
        "The decision path contains a cycle.",
      );
    }
    visited.add(currentDecisionId);

    // A missing node means entryDecision or some next references an unknown id.
    const decision = decisionsById.get(currentDecisionId);
    if (decision === undefined) {
      throw new DecisionEvaluationError(
        decisionErrorCodes.unknownDecision,
        "The requested decision could not be found.",
      );
    }

    const branch = findMatchingBranch(decision, input.context);
    trace.push({
      decisionId: decision.id,
      matchedWhen: branch?.when ?? null,
      nextDecision: branch?.next ?? null,
      question: decision.question,
    });
    if (branch === undefined) {
      return {
        entryDecision: input.entryDecision,
        noMatchReason: "no branch matched the provided context",
        recommendations: [],
        status: "no_match",
        trace,
      };
    }

    // Deduplicate by Practice id while merging reasons from each matched branch.
    for (const practiceId of new Set(branch.recommend)) {
      const existing = recommendations.get(practiceId);
      if (existing === undefined) {
        recommendations.set(practiceId, { practiceId, reasons: [branch.reason] });
      } else {
        existing.reasons.push(branch.reason);
      }
    }

    if (branch.next === undefined) {
      return {
        entryDecision: input.entryDecision,
        recommendations: [...recommendations.values()],
        status: "matched",
        trace,
      };
    }
    currentDecisionId = branch.next;
  }
}

/**
 * Return the first branch whose condition is true, in declaration order, or
 * undefined when none match. All when conditions in a node are parsed before
 * any is evaluated, so a later syntax error cannot be masked by an earlier
 * match (ADR 0008).
 */
function findMatchingBranch(
  decision: DecisionNode,
  context: DecisionEvaluationInput["context"],
): DecisionBranch | undefined {
  const parsedBranches: Array<{ branch: DecisionBranch; condition: Expression }> = [];
  try {
    for (const branch of decision.branches) {
      parsedBranches.push({ branch, condition: parseCondition(branch.when) });
    }
  } catch (error) {
    if (error instanceof ConditionSyntaxError) {
      throw new DecisionEvaluationError(
        decisionErrorCodes.invalidCondition,
        "A decision condition is invalid.",
      );
    }
    throw error;
  }

  // Syntax was validated up front; take the first matching branch in declaration order.
  for (const { branch, condition } of parsedBranches) {
    if (evaluateParsedCondition(condition, context)) return branch;
  }
  return undefined;
}
