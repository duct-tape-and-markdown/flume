# DELTA

<last-plan>
!`git log --grep='^plan:' -n 1 --format='%H %s' 2>/dev/null || echo "(no prior plan: commit — bootstrap tick)"`
</last-plan>

<commit-delta>
!`LAST=$(git log --grep='^plan:' -n 1 --format='%H' 2>/dev/null); if [ -n "$LAST" ]; then echo "=== commits since $LAST ==="; git log "$LAST..HEAD" --format='%H %s' 2>/dev/null; echo; echo "=== diffs (preview; run git diff directly if you need more) ==="; git log "$LAST..HEAD" -p --stat 2>/dev/null | head -300; else echo "(bootstrap: no commits to audit)"; fi`
</commit-delta>

<spec-delta>
!`LAST=$(git log --grep='^plan:' -n 1 --format='%H' 2>/dev/null); if [ -n "$LAST" ]; then DIFF=$(git diff "$LAST..HEAD" -- spec/ 2>/dev/null); if [ -z "$DIFF" ]; then echo "(no spec changes since last plan)"; else echo "$DIFF" | head -300; fi; else echo "(bootstrap: read spec/RELEASE-v0.1.md in full — it is the delta)"; fi`
</spec-delta>

<pending-now>
!`cat .flume/plan/pending.json 2>/dev/null || echo "[]"`
</pending-now>

<inbox>
!`cat .flume/inbox.md 2>/dev/null || echo "(no inbox)"`
</inbox>

<state>
!`cat .flume/plan/state.md 2>/dev/null || echo "(no prior state)"`
</state>

<open-questions>
!`cat .flume/plan/open-questions.md 2>/dev/null || echo "(none)"`
</open-questions>

<tsc>
!`pnpm tsc --noEmit 2>&1 | tail -10 || true`
</tsc>

# TASK

Plan processes the **delta** between this tick and the last `plan:` commit. The delta is the unit of work. Each dimension of the delta drives one concern; the heaviest dimension implicitly sets the tick's `mode` tag — `audit`, `derive`, or `maintain` (when inbox-drain and unblock-promote are the only meaningful dimensions).

**Default posture: research-leaning** — see `.claude/rules/collaboration.md` (*Inform before parking*) before logging an open question.

## Dimensions

**Audit (commit-delta).** Trigger: at least one commit in `<commit-delta>`. For each commit, cross-check the diff against the `per.section` it cites. Look for spec drift, missed cases, undertested logic, scope creep beyond `entry.files`, gate-bypass. Findings route to pending entries (with `per` cite), open questions (when human input is needed), or accepted-debt (one-line in commit body). **Do not write to inbox.md** — that's an external-contributor surface.

**Derive (spec-delta or bootstrap).** Trigger: `spec/` changed since the last `plan:` commit, OR there is no prior `plan:` commit. Decompose changed or added spec sections into pending entries. Each entry: `per.section` matches the heading verbatim (no `## ` prefix), `files.{new,edit,retire}` are exact paths verified against build's `writablePaths`, `blockedBy` is set if a prior entry must ship first, `acceptance` is one line that turns green. Decompose into discrete, shippable units. If a single section would require many large entries, that's a signal the section is too broad — file an open question proposing a spec split instead.

**Drain (inbox).** Trigger: `<inbox>` non-empty. Each entry routes to one of: pending entry (with `per` cite), open question (parked), or accepted-debt (one-line in commit body). Remove drained entries; preserve the `inbox.md` header. The inbox is a queue, not a log.

**Promote (unblock).** Trigger: any entry in `<pending-now>` with `gate.kind === "blockedBy"` whose `gate.tag` is no longer a tag in `<pending-now>`. Flip such entries to `gate.kind: "open"`. This is mechanical — process all of them.

## How much to do this tick

Each dimension is processed *to its quality bar*, not to a count. Audit deeply enough to catch real drift. Derive entries telegraphic enough that build can act mechanically. Route inbox entries you can route cleanly; leave the rest for next tick rather than guess.

If the delta is small enough that you can meet the bar across every dimension, do so. If a dimension is too large to process fully without diluting quality, take the slice that matters most — the commits that touched the most consequential surfaces, the spec sections that gate the most downstream entries, the oldest inbox entries that have been waiting — and set `Plan continues: yes — <which dimension overflowed>` in state.md. The harness re-wakes plan; the next tick takes the next slice. You decide where the cut falls.

## Always-on (every tick)

- **Verify writable paths** for entries you touched this tick. Off-allowlist file paths become open questions proposing chain.ts amendments, not pending entries.
- **Re-derive state.md from scratch** — phase, this tick's `mode` tag, queue head, in-flight work, open-questions count, trunk status. **Final line is mandatory: `Plan continues: yes — <one-line reason>` OR `Plan continues: no`.** The harness re-wakes plan iff `yes`; absence is treated as `no`.

## Field discipline

`files[].description`, `tests[].asserts`, `acceptance`, and `notes` are pointers, not spec restatements (per `.claude/rules/collaboration.md` — *Match prose to the medium*). If `description` reads like *"Add X: if input matches /pattern/ then…"*, you're duplicating the spec; the right shape is *"Widen X per §N."* The `per` cite is the reader's path to mechanics — trust it. Telegraphic: short enough that next-tick-you can scan; if you find yourself writing prose, you've shifted register.

# OUTPUT

Commit all changes in one commit prefixed `plan:`. **Body opens with `mode: <audit|derive|maintain>`** followed by narrative — which dimensions of the delta you processed, what you routed where, what you accepted as debt, where you set the cut if you didn't cover everything. Write:

- `.flume/plan/pending.json` — JSON array conforming to the schema below.
- `.flume/plan/state.md` — markdown, ending with `Plan continues: yes|no`.
- `.flume/plan/open-questions.md` — markdown.
- `.flume/inbox.md` — drained entries removed; preserve the header.

The harness will reject your commit if `pending.json` doesn't parse, or if you modify anything outside the phase's writable paths.

For `per.path`, use `spec/RELEASE-v0.1.md`. For `per.section`, use the exact section heading text from the spec without the leading `## ` (e.g. `3. CLI surface`, `5. Tests`, `8. Repository hygiene`).

<schema>
{{PENDING_SCHEMA}}
</schema>
