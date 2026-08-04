# ContextTrees

A macro/micro context system for AI-assisted software projects: a persistent, versioned **design
map** feeds ephemeral, scoped **micro sessions**, whose outcomes flow back as reviewable
recommendations rather than silent overwrites.

Designed with Naulon usage in mind, but standalone — no dependency on any specific host project,
agent framework, or LLM provider. See [`docs/SPEC.md`](docs/SPEC.md) for the full working spec
this implementation follows.

## Why

Long-running AI-assisted projects tend to hit one of two failure modes: every new chat starts from
zero context (the user re-explains the project each time), or every chat inherits the entire
history (context bloat, stale/contradictory state). ContextTrees splits the difference:

- A **macro layer** holds the project's persistent, versioned state — a hierarchical design map
  (System → Subsystem → Component) that changes deliberately.
- A **micro layer** spins up ephemeral sessions scoped to one feature/task, assembled from the
  relevant *branch* of the design map instead of the whole thing.
- When a session ends, its outcome splits into two independent, reviewable update paths: what the
  design map should absorb, and what the agent should carry forward into future sessions.

## Core concepts

| Concept | Module | What it is |
|---|---|---|
| Design map | `src/design-map.ts` | Versioned, hierarchical project state. Updates append a new version; nothing is overwritten. |
| Agent memory | `src/agent-memory.ts` | Per-agent retained context, tagged by session + timestamp, scored for retain/drop and for splitting into a parallel sibling agent. |
| Harness | `src/harness.ts` | A toolset + system prompt + constraints an agent is equipped with, independent of any one agent instance. |
| Director | `src/director.ts` | The macro agent: starts sessions scoped to a design-map branch, reconciles their outcomes back. |
| Micro session | `src/session.ts` | The ephemeral, feature-scoped unit of work; tracks recurring context passes to its agents. |
| Review mode | `src/review.ts` | Per-branch (design map vs. agent memory) auto-commit vs. manual-review-then-commit. |
| Refresh gate | `src/scheduler.ts` | Gates automated runs on a host's usage/session refresh, via a pluggable wakeup-scheduler adapter. |

## Example

```ts
import { Director, equipAgent, AUTO_REVIEW } from "contexttrees";

const director = new Director();
const system = director.designMap.addNode("system", "Core");
const auth = director.designMap.addNode("subsystem", "Auth", system.id);

const harness = director.harnesses.register({
  id: "reader",
  name: "Read-only harness",
  tools: ["read", "grep"],
  systemPrompt: "You investigate and report; you don't write code.",
});

const agent = equipAgent("micro", harness);
const session = director.startSession({
  description: "Add a login form to the Auth subsystem",
  branchNodeId: auth.id,
  agents: [agent],
  reviewMode: AUTO_REVIEW,
});

session.recordContextPass("scoped to existing session-token handling");

const outcome = director.endSession(session, {
  designMapUpdates: [
    { nodeId: auth.id, content: { summary: "Auth + login form", roadmap: [], bugs: [], futureReview: [] } },
  ],
  agentMemoryUpdates: [
    {
      agentId: agent.id,
      retain: [
        { concept: "login-form-pattern", content: "...", sessionId: session.id, relevanceScore: 0.9, reuseScore: 0.8 },
      ],
    },
  ],
});

// AUTO_REVIEW commits both branches immediately; outcome.designMap.committed === true.
// With MANUAL_REVIEW instead, nothing commits until outcome.designMap.apply(...) /
// outcome.agentMemory.apply(...) is called — optionally with a selected subset.
```

### Delaying automated runs until a session refreshes

```ts
import { RefreshGate } from "contexttrees";

const gate = new RefreshGate(usageWindowResetsAtEpochMs, {
  scheduleWakeup: (atEpochMs, reason) => myHost.scheduleWakeup(atEpochMs, reason),
});

const result = await gate.gate(() => runScheduledAgentWork());
if (!result.ran) {
  console.log(`quota exhausted, retrying at ${new Date(result.retryAtEpochMs).toISOString()}`);
}
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build   # emits dist/, gitignored
```

## Status

Early scaffold implementing the spec in `docs/SPEC.md`. Open questions (concurrent-branch writes,
a real embedding/frequency-based scoring model, restore/rollback of superseded versions, a review-mode
UI) are tracked at the bottom of that document rather than here.
