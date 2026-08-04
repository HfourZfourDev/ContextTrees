# ContextTrees — Working Spec

Working spec for the macro/micro context system: how project-level context persists, how ephemeral
working sessions are assembled from it, and how changes flow back. This document is the source of
truth for the data model and lifecycle implemented in `src/`. Designed with Naulon's workflow in
mind, but standalone — no dependency on any specific host project or LLM provider.

## 1. Layer overview

### Macro layer (persistent)

- **Project** — goals, constraints, glossary, top-level decisions. Changes rarely, changes
  deliberately.
- **Design map** — hierarchical structure: System → Subsystem → Component. Each node represents
  current state of a piece of the design. Versioned.
- **Design director agent (macro agent)** — routes context into micro sessions, reconciles updates
  back into the design map, maintains coherence across the project. Macro agents receive more
  deliberate tweaks/review than micro agents.

### Micro layer (ephemeral)

- **Micro session** — spun up on demand, scoped to a specific feature/task, assembled from a
  relevant branch of the design map rather than copy-pasted by the user.
- **Micro agents** — narrow-scope workers invoked within a session. Context is trimmed after each
  session ends. Can subdivide into parallel sibling agents when a feature grows too large for one
  agent's scope (same design-map territory, split by sub-branch).

## 2. Session lifecycle

1. New micro session created.
2. Initial feature description provided (what the session is for).
3. Relevant agents / harnesses selected based on the description and design map branch.
4. Context passed to micro agents — director scopes macro context (design map branch + relevant
   history) into the session.
5. Session runs. Context is re-passed to agents on a recurring loop as the session progresses (not
   a one-time injection).
6. Session ends.
7. Split into two parallel, independent update paths (Branch A, Branch B — see below).

## 3. Branch A — Agent memory

Governs what a micro agent carries forward into future sessions.

- **Auto trim** always runs and produces a recommendation, scored on two signals:
  - Relevance to the design map branch the agent is scoped to.
  - Likelihood of reuse in future sessions.
- **Manual review** (optional, user-configurable) — user can deselect any part of the auto
  recommendation before it's committed.
- **Recommend parallel agent** — triggered when a context grouping is used a lot but never in
  conjunction with the agent's other retained groups (i.e., high standalone reuse, low relevance to
  what the agent is currently doing). Typical cause: a feature outgrew single-agent scope and
  naturally subdivides. The new agent works the same design-map territory as the parent but scoped
  to a specific sub-branch.
- **Result**: agents tagged and trimmed. Retained context groups are tagged with session ID +
  timestamp, so they can be identified and deselected later. Conflicting retained context (same
  concept, different sessions) uses versioned entries rather than overwrite — most recent surfaces
  by default, history remains queryable.
- **Lineage**: any spun-off parallel agent tracks lineage back to its parent agent and the session
  that triggered the split.

## 4. Branch B — Design map update

Governs what gets written back into the persistent design map.

- **Auto-merge** always runs and produces a recommendation of structural changes (new/changed
  components, state transitions, etc.).
- **Manual review** (optional, user-configurable) — user can deselect any part of the merge before
  it's committed.
- **Result**: design map updated — reflected in roadmap, bugs, and future-review sections of the
  affected node(s). Versioned, same conflict model as agent memory.

## 5. Review mode

- At the start of each new micro session, the user confirms manual review or automatic for that
  session's eventual macro/agent updates.
- This setting is independent per branch — a user can choose automatic for the design map (low
  risk, easy to audit later in the map itself) while choosing manual for agent memory (invisible
  state, higher trust cost), or any other combination.
- Regardless of mode, auto trim / auto-merge always execute and produce the recommendation;
  "manual" only changes whether the user gets a chance to deselect items before commit, not whether
  the recommendation happens.

## 6. Data model notes

- **Design map**: hierarchical (System → Subsystem → Component), versioned nodes, each carrying
  roadmap / bugs / future-review metadata.
- **Agent memory**: per-agent list of retained context groups, each tagged (session_id,
  timestamp). Conflicting groups on the same concept are versioned, not overwritten.
- **Agent lineage**: parent_agent_id + originating_session_id on any spawned parallel agent.
- **Recommendation scoring** (both branches): relevance-to-current-branch + reuse-likelihood as the
  two primary signals. Keep the scoring model simple and legible — a user should be able to tell why
  something was recommended for retention/merge, or the auto mode stops being trustworthy.

## 7. Agent harnesses (per-agent + orchestration)

Two integration points, both in scope:

- **Per-agent harness** — each individual agent (macro or micro) can be equipped with its own
  harness: a specific toolset, system prompt/persona, and constraints, configured independently of
  other agents.
- **Orchestration layer** — the macro director orchestrates at the project/roadmap level; micro
  sessions orchestrate at the per-task/per-file level. Harnesses wrap agents at both levels: a macro
  agent's harness is scoped by the director's routing, a micro agent's harness is scoped by the
  session's design-map branch.

## 8. Execution gating on session refresh

Automated agent runs should not fire while the host's usage/session quota is exhausted. ContextTrees
exposes a `RefreshGate` that a scheduled run checks before dispatching agent work: if a refresh time
is known and hasn't passed, the run reports "not ready" instead of dispatching. This is deliberately
provider-agnostic — a host environment (such as Claude Code Remote's scheduled wakeups) implements
the `WakeupScheduler` adapter interface to convert a gate's "not ready, retry at T" into an actual
delayed resumption.

## 9. Open questions for implementation

- Exact scoring function for "relevance" and "reuse likelihood" (embedding similarity? usage
  frequency counts? explicit agent self-report?). Current implementation uses explicit, caller-supplied
  scores (0–1) so the scoring model stays swappable and legible; no embedding/frequency model is
  built in yet.
- Whether two parallel agents can share a single design-map branch, and if so, how the director
  reconciles simultaneous writes from both. Current implementation serializes design-map writes
  per-node with append-only versioning (last-write-wins pointer, full history retained), which
  avoids corruption but does not yet detect or flag concurrent-edit conflicts to the user.
- UI for the "confirm review mode" step — per-session prompt vs. a stored default with an override.
  Out of scope for this library; `ReviewModeConfig` supports both call patterns, no UI shipped here.
- Whether users can browse/restore superseded versions in the agent-memory and design-map version
  history, or whether that's read-only audit trail for now. Current implementation: read-only audit
  trail (`history()` accessors); no restore/rollback API yet.
