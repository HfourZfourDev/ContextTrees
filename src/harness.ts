import type { AgentDescriptor, AgentLineage, AgentRole, Harness } from "./types.js";

export interface HarnessInput {
  id: string;
  name: string;
  tools?: string[];
  systemPrompt: string;
  constraints?: string[];
}

/**
 * Toolset + system prompt + constraints, independent of any one agent.
 * Agents are equipped with a harness by id, so the same harness can be
 * reused across sibling agents (e.g. a design-map-read-only harness shared
 * by several micro agents scoped to different sub-branches).
 */
export class HarnessRegistry {
  private harnesses = new Map<string, Harness>();

  register(input: HarnessInput): Harness {
    const harness: Harness = {
      id: input.id,
      name: input.name,
      tools: input.tools ?? [],
      systemPrompt: input.systemPrompt,
      constraints: input.constraints ?? [],
    };
    this.harnesses.set(harness.id, harness);
    return harness;
  }

  get(id: string): Harness | undefined {
    return this.harnesses.get(id);
  }

  requireHarness(id: string): Harness {
    const harness = this.harnesses.get(id);
    if (!harness) throw new Error(`HarnessRegistry: unknown harness "${id}"`);
    return harness;
  }

  all(): Harness[] {
    return [...this.harnesses.values()];
  }

  toSnapshot(): Harness[] {
    return this.all();
  }

  /** Lossless: harnesses carry no timestamps/versioning, so restoring via `register` doesn't lose anything. */
  static fromSnapshot(harnesses: Harness[]): HarnessRegistry {
    const registry = new HarnessRegistry();
    for (const harness of harnesses) registry.register(harness);
    return registry;
  }
}

let agentCounter = 0;
function nextAgentId(): string {
  agentCounter += 1;
  return `agent_${agentCounter}_${Date.now().toString(36)}`;
}

/**
 * Equip an agent (macro or micro) with a harness. Returns the descriptor
 * the director/session tracks — this is the "per-agent harness" integration
 * point, orthogonal to the macro/micro orchestration layer.
 */
export function equipAgent(
  role: AgentRole,
  harness: Harness,
  lineage?: AgentLineage,
): AgentDescriptor {
  return { id: nextAgentId(), role, harnessId: harness.id, lineage };
}
