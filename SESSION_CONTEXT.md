# Session Context

Handoff doc for whoever (human or Claude session) picks this up next. Read this first; read
[`docs/SPEC.md`](docs/SPEC.md) for the actual design spec; read the README for the public API and
usage examples. This file is status + next steps, not a spec — keep it short-lived and update it
as work lands rather than letting it drift from reality.

## What this is

ContextTrees: a macro (persistent, versioned design map) / micro (ephemeral, scoped session)
context system for AI-assisted software projects. Built with [Naulon](https://github.com/HfourZfourDev)
usage in mind, kept standalone. Core thesis: a project's roadmap is itself the context tree — every
built feature, planned feature, shell, and unintegrated piece is a versioned node, nodes reference
each other across branches with weighted (not fixed-hop) relevance, and a director agent scopes
each working session to exactly the branch plus decayed-relevance dependencies it needs.

## Current state (as of this commit on `main`)

- 63 tests passing, `npm run typecheck` and `npm run build` clean.
- Fully in-memory core + a Node persistence adapter on top (see below) — the in-memory core has no
  storage opinion of its own, so other backends (IndexedDB, a DB) are additive, not a rewrite.
- No CI workflow yet. No npm publish. `package.json` doesn't set `private`, so that decision hasn't
  been made either way.
- No end-to-end example of the full loop (director hands a real LLM/agent the assembled context,
  the agent does work, results feed back into `endSession`) — every test exercises the pieces, none
  wires up an actual model call.

### Module map

| Module | Owns |
|---|---|
| `src/types.ts` | Core data shapes: `DesignMapNode`, `FeatureStatus`, `EdgeRelevance`, `RetainedContextGroup`, `Harness`, etc. |
| `src/design-map.ts` | `DesignMap` — versioned roadmap tree, activation (dormant/active), edges, `assembleContext`/`contextText`. |
| `src/context-traversal.ts` | The weighted-decay math: `RelevanceCombinator`, `ContextTraversalOptions`, `classifyDetail`. |
| `src/agent-memory.ts` | `AgentMemory`/`AgentMemoryStore` — per-agent retained context, trim scoring, parallel-agent-split recommendation. |
| `src/harness.ts` | `HarnessRegistry`, `equipAgent` — per-agent toolset/prompt/constraints. |
| `src/session.ts` | `MicroSession` — the ephemeral unit of work, carries its assembled context. |
| `src/director.ts` | `Director` — orchestrates `startSession`/`endSession`, owns the design map + agent memories + harnesses, snapshot methods. |
| `src/review.ts` | `ReviewModeConfig` (auto vs. manual commit, per branch). |
| `src/scheduler.ts` | `RefreshGate` — delay automated runs until a host's usage window refreshes. |
| `src/scoring/` | Pluggable `RelevanceScorer`: no-model default, llama.cpp local model, Apple device-AI contract. |
| `src/persistence/` | Snapshot + Node file-store adapter. **Separate subpath export** (`contexttrees/persistence`), not in the main entry point, so non-Node consumers never pull in `node:fs`. |

## Known gaps (see `docs/SPEC.md` §9 for the full, precise list)

- Apple device-AI scorer is a typed contract (`NativeEmbeddingBridge`) with no real implementation
  — needs a macOS/iOS build environment to write and test the Swift/`NLEmbedding` side, which
  doesn't exist in this session's container.
- Concurrent-write conflicts on the design map aren't detected/flagged (append-only versioning
  avoids corruption, but two parallel agents editing the same node won't be told about each other).
- No content-version rollback (distinct from activation, which *is* implemented) — read-only audit
  trail only.
- Relevance-scoring and traversal-decay constants (`0.65*dependency + 0.35*importance`,
  `hierarchyDecay`, thresholds) are reasoned defaults, not calibrated against real usage.
- A node reached by multiple paths in `assembleContext` keeps only its highest-weight path, not all
  of them — fine for inclusion decisions, loses some "why was this included" audit detail.

## Recommended next steps, in priority order

1. **CI workflow.** `.github/workflows/` doesn't exist. Add typecheck + test + build on every push/PR
   before anything else lands, so `main` stays provably green going forward.
2. **Decide the product shape and build a thin integration layer.** Two live options, discussed and
   not yet chosen between:
   - An **MCP server** wrapping `Director` (`start_session`/`end_session`/`get_context`/
     `deactivate_node` as tools) — usable by Claude Code, Claude Desktop, or any MCP host with no
     per-host adapter code. Also the most immediately dogfoodable: a persistent roadmap surviving
     across Claude Code sessions is the exact problem this project exists to solve.
   - A direct **npm dependency** Naulon (or another host) calls into — `startSession()`/
     `endSession()` wired into its own session lifecycle.
   Either needs the persistence layer (done) plus a decision on storage location convention (where
   does `project.json` live relative to a repo?).
3. **End-to-end example.** Nothing in the repo currently shows the full loop — assembling context,
   handing it to a real agent call, capturing the agent's output, calling `endSession` with it.
   Worth one runnable example script even before the MCP/npm integration choice above, since it'd
   exercise the same seam either path needs.
4. **Naulon-specific integration** — blocked on this session not having Naulon's repo attached, so
   nothing here can be verified against its actual stack/data model. Needs someone with Naulon
   context to scope.
5. **Package publish decision.** Public npm package vs. git-dependency-only vs. private — pick one
   and set `package.json`'s `private` field accordingly; currently undecided by omission.

## Working agreement notes

- Two branches were in play earlier in development (`main` and a feature branch); as of this
  commit they're back in sync — `main` is current. No standing branch-discipline rule is
  established for this repo (unlike the sibling Token-Lean IDE project, which forbids committing
  directly to `main`); use judgment, prefer feature branches for anything non-trivial.
- Workflow gates for any change: `npm run typecheck`, `npm test`, `npm run build`, then `rm -rf
  dist` before committing (`dist/` is gitignored but a stray build shouldn't get committed by
  accident).
