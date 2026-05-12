# Cascade dry-run — v0 port findings

Date: 2026-05-12
Cascade SHA: `2eae5b8`

## What we tried

Express Cascade's current Flume chain as a `.flume/chain.ts` for the new
Flume, port 4 representative Pending entries to `.flume/plan/pending.json`,
and render the three phase prompts via `flume render <phase>` without
invoking Claude.

Artifacts created in Cascade (all untracked; legacy `.flume/prompts/*.md`
and `IMPLEMENTATION_PLAN.md` unchanged):

```
.flume/chain.ts                  Chain config; imports from sibling flume/
.flume/plan/pending.json         4 entries (3 gated, 1 demo-open)
.flume/plan/state.md             ported from IMPLEMENTATION_PLAN.md ## State
.flume/plan/open-questions.md    3-item subset of full OQ list
.flume/prompts.new/{plan,build,spec}.md   copied from flume/examples/prompts/
```

## What worked

- **Full prompt rendering end-to-end.** `flume render plan` produced 266 lines
  of correctly-substituted prompt: `<harness>` block, inline-exec bakes of
  pending.json / state / specs / tsc / recent-commits, task body, and
  schema injection via `{{PENDING_SCHEMA}}`.
- **Harness block injection replaces real prose.** The auto-prepended
  `<harness>` block lists writable paths and gates. Legacy `plan.md` had
  ~10 lines of "You may NOT" rules; new `plan.md` has zero — the block
  carries the whole capability surface.
- **Schema-validated JSON travels into the prompt.** `renderSchemaForPrompt()`
  injects via `{{PENDING_SCHEMA}}`. Single source of truth for parser +
  prompt; cannot drift.
- **Build prompt's `{{ENTRY_JSON}}`** travels the full pending entry as
  one well-formatted JSON blob. The agent reads typed fields, no
  per-field interpolation gymnastics.
- **3 of 4 ported entries parse the schema cleanly** (TBD-shape entries
  with `acceptance` as "TBD on entry refinement" pass the `min(1)` check).

## What broke / needs work before a real port

### 1. Tag regex too narrow

Cascade's real tags include `OBS4.2`, `PT4.7(c)`, `PT4.5c` — dot-separated
version-like tags. My regex (`^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)*(?:\([a-z0-9]+\))?$`)
rejects dots. Real tag examples that pass and fail:

| Tag                       | Status     |
| ------------------------- | ---------- |
| `ROSTER-TRIAGE-MIG(b)`    | OK         |
| `MAINTAIN-tsc-a31893e`    | OK         |
| `SURFACE-CTA-MIG`         | OK         |
| `OBS4.2`                  | **FAIL**   |
| `PT4.7(c)`                | **FAIL**   |

**Fix:** allow `.` in the body. New regex:
`^[A-Z][A-Z0-9]*(?:[-.][A-Za-z0-9]+)*(?:\([a-z0-9]+\))?$`

### 2. `per.section` semantics don't match Cascade's spec conventions

The build prompt's `<per>` block uses `sed` to extract a section by markdown
heading:

```
sed -n '/^#\+ {{PER_SECTION}}/,/^#\+ /p' {{PER_PATH}}
```

But Cascade specs cite decisions by **name token** (e.g.
`PerSurfacePrimaryActionInHeader`) or by `→`-separated nested path (e.g.
`Plan workspace shape → Per-athlete Plan editing`), not by markdown
heading text. The render produced an empty `<per>` block for
`DEMO-OPEN-EXAMPLE` because the decision name doesn't match an `##`
heading.

**Two options:**
- **(a)** Add `per.headingPath: string[]` to the schema, so cites carry the
  exact heading chain the renderer should grep for. Heavier but unambiguous.
- **(b)** Treat `per.section` as a free-text search token; the renderer
  does fuzzy extraction (grep + surrounding context lines). Lighter but
  the agent sees noisier `<per>` blocks.

Cascade's current PROTOCOL.md `Per:` line treats this as free-text; the
agent re-reads the spec via prose understanding. So **(b)** matches
current posture; the harness just surfaces "here's the spec; search for
your section."

### 3. TBD-shape gated entries need a schema variant (or schema relaxation)

3 of 4 ported entries had effectively empty `files` (TBD until gate opens)
and `acceptance: "TBD on entry refinement"`. They parse — but they're not
*pickable* either. The schema doesn't distinguish "this is a placeholder
for future work, refine when gate opens" from "this is ready to ship."

The legacy plan handles this by separating Pending into sections:
"Decomposed but blocked on upstream", "Parked on /workshop", "Deferred-no-
consumer — carried indefinitely". The new schema flattens these into one
array with `gate.kind` carrying the lock — which loses the section
semantics.

**Fix candidates:**
- **(a)** Add `kind: "ready" | "draft"` to entries; `draft` permits sparse
  `files` and `acceptance: "TBD"`; only `ready` entries are pickable.
- **(b)** Move gated/parked entries to a separate `parked.json` /
  `deferred.json`; `pending.json` only carries pickable + soon-pickable.
- **(c)** Leave schema as-is; rely on `gate.kind !== "open"` to mean
  "details may be sparse"; document this in `renderSchemaForPrompt()`.

Leaning **(c)** for v0 simplicity, **(a)** if the distinction matters for
plan-phase reasoning later.

### 4. Build prompt's spec-extraction would fail for most Cascade citations

Beyond (2), even with a section-fuzzy approach, Cascade specs cross-cite
heavily (`per` cite often references **another spec** that the immediate
section depends on). The agent today follows these via prose; the new
prompt would need either a multi-cite `per.depends: string[]` field, or
acceptance that the agent does some disk-walking itself.

Current posture leans accept-disk-walking: the rendered prompt's `<active-specs>`
listing gives the agent the full corpus index.

### 5. Schema-delta path lacks a Docker-host gate

Cascade carries 7+ accumulated schema deltas pending `pnpm db:push
--accept-data-loss` (per the Open Questions). The new schema has
`gate: { kind: "requiresDockerHost" }` which the dispatcher treats as
non-pickable by default. Wiring this requires:

- A way for the dispatcher to opt into `requiresDockerHost` (env flag /
  CLI flag).
- A pre-check that `docker info` succeeds before fanning out.

Deferred to v1 alongside the Docker sandbox provider.

## Side-by-side prompt comparison

Legacy `plan.md` (47 lines): 30 lines of *discipline prose* ("Never author
intent", "You may NOT modify spec or workshop content", "Touch
`.flume/awake/build` when..."), 17 lines of *task* and *handoff*.

New `plan.md` (60 lines, source): **0 lines of discipline prose**. 13
lines of inline-exec context bakes (pending, state, specs, tsc, commits),
~40 lines of *task* (a richer specification of what to produce), 5 lines
of *output declaration*. The discipline lives in:

- The harness's auto-prepended `<harness>` block (capability surface).
- The pending-schema gate (output shape).
- The writable-paths gate (capability enforcement).
- The chain config's `humanOnly: ["spec"]` rule (baton restrictions).
- The chain config's `handoff()` function (what to wake next).

**Net:** the new prompt's *agent-facing surface* is roughly the same
length, but the *rule surface* (what the agent must remember to do
correctly) has collapsed. The agent's job is to produce a conforming
output; the harness's job is to verify it.

## Verdict on the v0 criterion

> From a fresh clone of a Flume-driven repo, replacing the old harness
> with the new one produces the same sequence of commits the prior
> harness would have, while prompts shrink because validation moved into
> harness-enforced gates.

**Partially proven:**

- ✅ The rendering pipeline works against Cascade's real disk state.
- ✅ Prompts have shrunk in their rule-surface (the load-bearing claim).
- ✅ The harness owns validation, capability, and schema.
- ⚠ Same-sequence-of-commits is unproven and untestable without resolving
  findings (1)–(3): with the current schema, a real plan tick would emit
  pending.json containing entries that don't parse — the legacy plan
  carries dot-tags and TBD entries the new schema rejects.

## Recommended next moves

1. **Fix the tag regex** — trivial, no design implication.
2. **Decide on draft/ready entry variant** (finding 3) — small design call.
3. **Decide on per.section semantics** (finding 2) — small design call.
4. **Then run a real plan tick** in a Cascade scratch clone and verify the
   produced pending.json round-trips through the parser without violations.
5. **Add a `flume migrate-plan` command** that mechanically converts a
   legacy `IMPLEMENTATION_PLAN.md` to `pending.json`, surfacing per-entry
   validation failures for human review. This is the "v0 cutover tool."
