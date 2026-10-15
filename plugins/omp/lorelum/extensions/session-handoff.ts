import type { BeforeSubagentSpawnEvent, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

interface Holder {
  keys: Set<string>;
  invalidate?: () => void;
}

interface Handoff {
  parent: { agentId: string; sessionId: string } | undefined;
  mainSessionId: string | undefined;
  source: Handoff | undefined;
  dependents: Set<Handoff>;
  producer: symbol;
  holders: Map<symbol, Holder>;
  claimant?: symbol;
}

// Factories are rebound for children, but their native event buses are not shared.
// Only dispatch identity lives here; candidate data remains behind the CLI bridge.
const handoffs = new Map<string, Handoff>();

function rejectHandoff(handoff: Handoff): void {
  handoff.parent = undefined;
  for (const holder of handoff.holders.values()) holder.invalidate?.();
  for (const dependent of handoff.dependents) rejectHandoff(dependent);
}

export function createSessionHandoff(invalidate: () => void) {
  const owner = Symbol("Lorelum session handoff");
  const keys = new Set<string>();
  let claimed = false;
  let stopped = false;
  let binding:
    | { handoff: Handoff; childId: string; parentId: string; sessionId: string }
    | undefined;

  const boundHandoff = (ctx: ExtensionContext): Handoff | undefined => {
    if (
      stopped ||
      !binding ||
      ctx.agent.kind !== "sub" ||
      ctx.agent.id !== binding.childId ||
      ctx.agent.parentId !== binding.parentId ||
      ctx.sessionManager.getSessionId() !== binding.sessionId ||
      !binding.handoff.parent
    )
      return undefined;
    return binding.handoff;
  };
  return {
    capture(event: BeforeSubagentSpawnEvent, ctx: ExtensionContext): void {
      if (stopped || !event.spawnKey || !ctx.agent.id) return;
      const source = boundHandoff(ctx);
      const sessionId = ctx.sessionManager.getSessionId();
      if (!sessionId) return;
      const key = event.spawnKey;
      const existing = handoffs.get(key);
      if (existing) {
        // Even equal snapshots cannot prove that two dispatches name the same child.
        rejectHandoff(existing);
        if (!existing.holders.has(owner)) existing.holders.set(owner, { keys });
      } else {
        const handoff: Handoff = {
          parent: { agentId: ctx.agent.id, sessionId },
          mainSessionId: ctx.agent.kind === "main" ? sessionId : source?.mainSessionId,
          source,
          dependents: new Set(),
          producer: owner,
          holders: new Map([[owner, { keys }]]),
        };
        handoffs.set(key, handoff);
        source?.dependents.add(handoff);
      }
      keys.add(key);
    },

    bind(ctx: ExtensionContext): void {
      if (stopped || claimed) return;
      claimed = true;
      if (ctx.agent.kind !== "sub" || !ctx.agent.parentId) return;
      const handoff = handoffs.get(ctx.agent.id);
      if (!handoff) return;
      const parentId = ctx.agent.parentId;
      if (
        handoff.parent?.agentId !== parentId ||
        (handoff.claimant !== undefined && handoff.claimant !== owner)
      ) {
        rejectHandoff(handoff);
      } else {
        // Transfer a claimed entry to the child so normal completion frees it
        // without retaining every completed child until the parent's shutdown.
        handoff.holders.get(handoff.producer)?.keys.delete(ctx.agent.id);
        handoff.holders.delete(handoff.producer);
      }
      handoff.claimant ??= owner;
      handoff.holders.set(owner, { keys, invalidate });
      keys.add(ctx.agent.id);
      binding = {
        handoff,
        childId: ctx.agent.id,
        parentId,
        sessionId: ctx.sessionManager.getSessionId(),
      };
    },

    mainSessionId(ctx: ExtensionContext): string | undefined {
      return boundHandoff(ctx)?.mainSessionId;
    },

    shutdown(): void {
      stopped = true;
      binding = undefined;
      for (const key of keys) {
        const handoff = handoffs.get(key);
        if (!handoff?.holders.delete(owner)) continue;
        if (handoff.holders.size === 0) {
          handoffs.delete(key);
          handoff.source?.dependents.delete(handoff);
        }
      }
      keys.clear();
    },
  };
}
