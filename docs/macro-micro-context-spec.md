# Macro/Micro Context System — Working Spec

Working spec for the macro/micro context system: how project-level context
persists, how ephemeral working sessions are assembled from it, and how
changes flow back.

## 1. Layer overview

### Macro layer (persistent)

- **Project** — goals, constraints, glossary, top-level decisions. Changes
  rarely, changes deliberately.
- **Design map** — hierarchical structure: System → Subsystem → Component.
  Each node represents current state of a piece of the design. Versioned.
- **Design director agent (macro agent)** — routes context into micro
  sessions, reconciles updates back into the design map, maintains coherence
  across the project. Macro agents receive more deliberate tweaks/review than
  micro agents.

### Micro layer (ephemeral)

- **Micro session** — spun up on demand, scoped to a specific feature/task,
  assembled from a relevant branch of the design map rather than
  copy-pasted by the user.
- **Micro agents** — narrow-scope workers invoked within a session. Context
  is trimmed after each session ends. Can subdivide into parallel sibling
  agents when a feature grows too large for one agent's scope (same
  design-map territory, split by sub-branch).

## 2. Session lifecycle

1. New micro session created.
2. Initial feature description provided (what the session is for).
3. Relevant agents / harnesses selected based on the description and design
   map branch.
4. Context passed to micro agents — director scopes macro context (design
   map branch + relevant history) into the session.
5. Session runs. Context is re-passed to agents on a recurring loop as the
   session progresses (not a one-time injection).
6. Session ends.
7. Split into two parallel, independent update paths:

## 3. Branch A — Agent memory

Governs what a micro agent carries forward into future sessions.

- **Auto trim** always runs and produces a recommendation, scored on two
  signals:
  - Relevance to the design map branch the agent is scoped to.
  - Likelihood of reuse in future sessions.
- **Manual review** (optional, user-configurable) — user can deselect any
  part of the auto recommendation before it's committed.
- **Recommend parallel agent** — triggered when a context grouping is used a
  lot but never in conjunction with the agent's other retained groups (i.e.,
  high standalone reuse, low relevance to what the agent is currently
  doing). Typical cause: a feature outgrew single-agent scope and naturally
  subdivides. The new agent works the same design-map territory as the
  parent but scoped to a specific sub-branch.
- **Result**: agents tagged and trimmed. Retained context groups are tagged
  with session ID + timestamp, so they can be identified and deselected
  later. Conflicting retained context (same concept, different sessions)
  uses versioned entries rather than overwrite — most recent surfaces by
  default, history remains queryable.
- **Lineage**: any spun-off parallel agent tracks lineage back to its parent
  agent and the session that triggered the split.

## 4. Branch B — Design map update

Governs what gets written back into the persistent design map.

- **Auto-merge** always runs and produces a recommendation of structural
  changes (new/changed components, state transitions, etc.).
- **Manual review** (optional, user-configurable) — user can deselect any
  part of the merge before it's committed.
- **Result**: design map updated — reflected in roadmap, bugs, and
  future-review sections of the affected node(s). Versioned, same conflict
  model as agent memory.

## 5. Review mode

- At the start of each new micro session, the user confirms manual review or
  automatic for that session's eventual macro/agent updates.
- This setting is independent per branch — a user can choose automatic for
  the design map (low risk, easy to audit later in the map itself) while
  choosing manual for agent memory (invisible state, higher trust cost), or
  any other combination.
- Regardless of mode, auto trim / auto-merge always execute and produce the
  recommendation; "manual" only changes whether the user gets a chance to
  deselect items before commit, not whether the recommendation happens.

## 6. Data model notes

- **Design map**: hierarchical (System → Subsystem → Component), versioned
  nodes, each carrying roadmap / bugs / future-review metadata.
- **Agent memory**: per-agent list of retained context groups, each tagged
  `(session_id, timestamp)`. Conflicting groups on the same concept are
  versioned, not overwritten.
- **Agent lineage**: `parent_agent_id` + `originating_session_id` on any
  spawned parallel agent.
- **Recommendation scoring** (both branches): relevance-to-current-branch +
  reuse-likelihood as the two primary signals. Keep the scoring model simple
  and legible — a user should be able to tell why something was recommended
  for retention/merge, or the auto mode stops being trustworthy.

## 7. Open questions for implementation

- Exact scoring function for "relevance" and "reuse likelihood" (embedding
  similarity? usage frequency counts? explicit agent self-report?).
- Whether two parallel agents can share a single design-map branch, and if
  so, how the director reconciles simultaneous writes from both.
- UI for the "confirm review mode" step — per-session prompt vs. a stored
  default with an override.
- Whether users can browse/restore superseded versions in the agent-memory
  and design-map version history, or whether that's read-only audit trail
  for now.
