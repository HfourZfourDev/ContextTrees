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

- A **macro layer** holds the project's persistent, versioned state. The roadmap *is* the tree:
  every built feature, planned feature, shell (integration point that exists but isn't built out),
  and unintegrated piece is a node, nested to whatever depth makes sense — not a fixed 3-tier
  hierarchy. Nodes in different branches can reference each other via **edges** ("checkout flows
  into payments"), independent of the parent/child structure.
- A **micro layer** spins up ephemeral sessions scoped to one feature/task, assembled from the
  relevant *branch* of the design map plus whatever weighted relevance spreads into it from
  elsewhere in the map — never the whole map, and never a rigid one-hop cutoff either.
- A branch can go **dormant** without being deleted: still there, still auditable, just excluded
  from context assembly until the director decides it's relevant again.
- When a session ends, its outcome splits into two independent, reviewable update paths: what the
  design map should absorb (including activation changes), and what the agent should carry forward
  into future sessions.

## Core concepts

| Concept | Module | What it is |
|---|---|---|
| Design map | `src/design-map.ts` | Versioned, unconstrained-depth roadmap tree. Each node has a `status` (built/planned/shell/unintegrated). Updates append a new version; nothing is overwritten. |
| Edges + weighted context assembly | `src/design-map.ts`, `src/context-traversal.ts` | Cross-branch references authored as `{dependency, importance, recency?}`, combined into a single weight that **decays** across edges and down hierarchy until it drops below a threshold — not a fixed hop limit. |
| Activation | `src/design-map.ts` | A node can go active/dormant without being deleted — dormant branches are excluded from context assembly but remain in the map for audit and reactivation. |
| Agent memory | `src/agent-memory.ts` | Per-agent retained context, tagged by session + timestamp, scored for retain/drop and for splitting into a parallel sibling agent. |
| Harness | `src/harness.ts` | A toolset + system prompt + constraints an agent is equipped with, independent of any one agent instance. |
| Director | `src/director.ts` | The macro agent: starts sessions scoped to a design-map branch (assembling its targeted context), reconciles their outcomes back, audits dormant branches. |
| Micro session | `src/session.ts` | The ephemeral, feature-scoped unit of work; carries the context it was actually given, tracks recurring context passes to its agents. |
| Review mode | `src/review.ts` | Per-branch (design map vs. agent memory) auto-commit vs. manual-review-then-commit. |
| Refresh gate | `src/scheduler.ts` | Gates automated runs on a host's usage/session refresh, via a pluggable wakeup-scheduler adapter. |
| Relevance scoring | `src/scoring/` | Pluggable context-manager scoring: no-model default, local model (llama.cpp), device AI (Apple). |
| Persistence | `src/persistence/` (subpath import) | JSON snapshot of the whole project (design map, agent memories, harnesses), with a Node file-store adapter. Not in the main entry point — see below. |

## Example

```ts
import { Director, equipAgent, AUTO_REVIEW } from "contexttrees";

const director = new Director();
const auth = director.designMap.addNode("feature", "Auth", null, { status: "built" });
const payments = director.designMap.addNode("feature", "Payments", null, { status: "built" });
const someStaleNode = director.designMap.addNode("feature", "Old password-reset flow", auth.id, { status: "shell" });

// Auth and Payments live in different branches but need to talk — declare the
// relationship explicitly. Weight is authored as dependency + importance
// (0-1 each, combined into a single decay weight, ~0.8 here) rather than a
// manually picked "full/interface/reference" label — see §Weighted context below.
director.designMap.addEdge(auth.id, payments.id, "integrates-with", { dependency: 0.9, importance: 0.6 });

const harness = director.harnesses.register({
  id: "reader",
  name: "Read-only harness",
  tools: ["read", "grep"],
  systemPrompt: "You investigate and report; you don't write code.",
});

const agent = equipAgent("micro", harness);
const session = director.startSession({
  description: "Add a login form to Auth",
  branchNodeId: auth.id,
  agents: [agent],
  reviewMode: AUTO_REVIEW,
});

// session.contextText is exactly what got assembled: the Auth branch in full,
// plus Payments (weight ~0.8, above the "full" threshold) and whatever
// decayed relevance spread further from there -- not the whole map.
session.recordContextPass("scoped to existing session-token handling");

const outcome = await director.endSession(session, {
  designMapUpdates: [
    { nodeId: auth.id, content: { summary: "Auth + login form", status: "built", roadmap: [], bugs: [], futureReview: [] } },
  ],
  agentMemoryUpdates: [
    {
      agentId: agent.id,
      // relevanceScore omitted: Director resolves it via its configured RelevanceScorer.
      retain: [{ concept: "login-form-pattern", content: "...", reuseScore: 0.8 }],
    },
  ],
  // The director judged some other branch stale during review -- deactivate it
  // rather than delete it. It stays in the map, out of context, until reactivated.
  activationUpdates: [{ nodeId: someStaleNode.id, active: false, reason: "superseded by login-form-pattern" }],
});

// AUTO_REVIEW commits all three (content, activation, agent memory) immediately.
// With MANUAL_REVIEW instead, nothing commits until outcome.designMap.apply(...) /
// outcome.agentMemory.apply(...) is called — optionally with a selected subset.

// Later: audit what's dormant, and bring something back if it turns out relevant.
director.auditDormantBranches().forEach((n) => console.log(n.name, "is dormant"));
director.designMap.activate(someStaleNode.id, { reason: "turns out we need it again" });
```

### Weighted context assembly

Edges don't declare a fixed detail level — they declare `{dependency, importance, recency?}`, which
combine (`src/context-traversal.ts`) into a single 0-1 weight. Context assembly is a decay-limited
search out from the session's branch: at every hop — across an edge, or down into a node's own
children — weight gets multiplied by that hop's weight, and the search stops expanding once
accumulated weight drops below `inclusionThreshold`. Nodes that do clear the bar are rendered at a
detail tier (`full` / `interface` / `reference`) computed from how much weight they still have.

This is deliberately not a fixed hop count. One global inclusion threshold, combined with
multiplication, produces the "adaptive strictness" you'd want without per-branch tuning: a strong
edge (0.8) leaves several decayed hops of room before its descendants fall out; a weak edge (0.3)
leaves almost none — its children need to retain nearly all of that 0.3 to still qualify. A specific
child that matters more than its siblings can be given its own edge directly to its parent,
overriding the default per-level decay for just that pair:

```ts
// B -> D is weak (0.3): most of D's children get pruned by default decay next hop.
director.designMap.addEdge(b.id, d.id, "data-hookup", { dependency: 0.35, importance: 0.2 });

// ...except this one, which is explicitly marked critical to D and survives anyway.
director.designMap.addEdge(d.id, criticalChild.id, "critical-path", { dependency: 0.95, importance: 0.9 });
```

Tune the defaults globally (`new DesignMap({ inclusionThreshold: 0.15, hierarchyDecay: 0.8 })`) or
per session (`director.startSession(init, { inclusionThreshold: 0.15 })`); swap `combinator` for a
custom function if dependency/importance/recency isn't the right formula for your project.

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

### Persistence

Everything above lives in memory only until it's snapshotted. `Director.toSnapshot()` /
`Director.fromSnapshot()` capture and restore the whole project — design map (every node's full
version and activation history, every edge with its relevance signals), every agent's retained
memory, and registered harnesses — exactly as stored, not replayed through the normal API (which
would mint new ids/timestamps). What's deliberately *not* part of a snapshot: the `RelevanceScorer`
and the design map's `combinator`, since both can be functions or reach out to a local model/native
bridge — runtime dependencies, not project data. Sessions are ephemeral by design and aren't
snapshotted either.

```ts
import { Director } from "contexttrees";

const snapshot = director.toSnapshot(); // plain JSON-serializable object
const restored = Director.fromSnapshot(snapshot, { scorer: myScorer }); // scorer re-supplied, not stored
```

The core package has no filesystem dependency — a browser host could snapshot into IndexedDB, for
instance. For Node, a file-backed adapter with atomic writes (write-temp-then-rename, so a crash
mid-write never corrupts the project file) is available as a separate subpath import, kept out of
the main entry point so browser/bundler consumers of the rest of the library never pull in
`node:fs`:

```ts
import { saveProjectToFile, loadProjectFromFile, loadOrCreateProjectFile } from "contexttrees/persistence";

await saveProjectToFile(director, "./project.json");
const restored = await loadProjectFromFile("./project.json");

// First run, file doesn't exist yet: returns a fresh empty Director instead of throwing.
const director2 = await loadOrCreateProjectFile("./project.json");
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
a real embedding/frequency-based scoring model, restore/rollback of superseded *content* versions,
how deep to chase edges, a review-mode UI) are tracked at the bottom of that document rather than
here. Note that node **activation** (dormant vs. active) is implemented and is not one of those
open questions — it's a separate, working mechanism from content-version rollback.
