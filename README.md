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
| Relevance scoring | `src/scoring/` | Pluggable context-manager scoring: no-model default, local model (llama.cpp), device AI (Apple). |

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

const outcome = await director.endSession(session, {
  designMapUpdates: [
    { nodeId: auth.id, content: { summary: "Auth + login form", roadmap: [], bugs: [], futureReview: [] } },
  ],
  agentMemoryUpdates: [
    {
      agentId: agent.id,
      // relevanceScore omitted: Director resolves it via its configured RelevanceScorer.
      retain: [{ concept: "login-form-pattern", content: "...", reuseScore: 0.8 }],
    },
  ],
});

// AUTO_REVIEW commits both branches immediately; outcome.designMap.committed === true.
// With MANUAL_REVIEW instead, nothing commits until outcome.designMap.apply(...) /
// outcome.agentMemory.apply(...) is called — optionally with a selected subset.
```

### Relevance scoring: three context-manager options

`Director` resolves a retain candidate's `relevanceScore` (how relevant proposed context is to the
design-map branch it's scoped to) via a pluggable `RelevanceScorer`, in priority order:

1. **No model (default)** — dependency-free term-frequency cosine overlap. No setup, weaker across
   paraphrases.
2. **Local model** — embeddings from a user-run [llama.cpp](https://github.com/ggml-org/llama.cpp)
   server (`llama-server`), any embedding-capable GGUF model (e.g. a Gemma embedding build).
   ContextTrees never bundles or launches a model itself.
3. **Device AI** — on-device embeddings via a host-supplied native bridge. Apple first
   (`NLEmbedding` from the NaturalLanguage framework); other platforms (e.g. Android/Gemini Nano)
   would follow the same bridge shape later.

These are exactly the three options a selection UI should offer; picking `local-llama-cpp` or
`device-apple` is where the user gets prompted for that variant's remaining fields:

```ts
import { createScorer, Director } from "contexttrees";

// 1. No model — no further input needed.
const noModel = createScorer({ kind: "none" });

// 2. Local model — prompt for server URL / model name.
const local = createScorer({ kind: "local-llama-cpp", baseUrl: "http://127.0.0.1:8080" });

// 3. Device AI — the native bridge comes from the host app, not typed input;
//    `variant` (word vs. sentence embeddings) is the one user-facing choice.
const device = createScorer({ kind: "device-apple", bridge: myAppleNativeBridge, variant: "sentence" });

const director = new Director(undefined, undefined, undefined, local);
```

`AppleIntelligenceScorer` is a typed contract (`NativeEmbeddingBridge`), not a working
implementation — there's no macOS/iOS runtime available to build or test the Swift side of that
bridge from here. A host app on Apple platforms implements `embed()` by calling `NLEmbedding` from
a native module and wires it in; the JS side then works unchanged.

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
