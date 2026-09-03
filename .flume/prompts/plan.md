# DELTA

<commit-delta>
!`STAMP=$(grep -m1 '^Audited through:' .flume/plan/state.md 2>/dev/null | grep -o '[0-9a-f]\{7,40\}' | head -1); if [ -z "$STAMP" ]; then STAMP=$(git log --grep='^plan:' -n 1 --format='%H' 2>/dev/null); BOOT=" (bootstrap: no audit stamp — window falls back to the last plan: commit; stamp what you audit this tick)"; fi; if [ -z "$STAMP" ]; then echo "(bootstrap: no commits to audit)"; elif ! git rev-parse --verify -q "$STAMP^{commit}" >/dev/null 2>&1; then echo "REFUSE: audit stamp $STAMP does not resolve to a commit. Audit nothing and advance nothing this tick; repair the stamp in state.md and say so in the commit body."; else echo "=== commits since $STAMP$BOOT ==="; git log "$STAMP..HEAD" --format='%H %s' 2>/dev/null; echo; echo "=== diffs (preview; run git diff directly if you need more) ==="; git log "$STAMP..HEAD" -p --stat 2>/dev/null | head -300; fi`
</commit-delta>

<spec-delta>
!`STAMP=$(grep -m1 '^Spec derived through:' .flume/plan/state.md 2>/dev/null | grep -o '[0-9a-f]\{7,40\}' | head -1); if [ -z "$STAMP" ]; then echo "(bootstrap: no derive stamp in state.md - read all of spec/*.md in full, the whole corpus is the delta, and stamp HEAD)"; elif ! git rev-parse --verify -q "$STAMP^{commit}" >/dev/null 2>&1; then echo "REFUSE: derive stamp $STAMP does not resolve to a commit. Derive nothing and advance nothing this tick; repair the stamp in state.md and say so in the commit body."; else echo "=== spec/ changes since the derive stamp $STAMP ==="; DIFF=$(git diff "$STAMP..HEAD" -- spec/ 2>/dev/null); if [ -z "$DIFF" ]; then echo "(no spec changes since the stamp)"; else echo "$DIFF" | head -400; fi; fi`
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

Plan processes the **delta** since the last tick that did the work. Each dimension carries its own window, and each window is a stamp on disk — never a `git log` grep. The delta is the unit of work. Each dimension of the delta drives one concern; the heaviest dimension implicitly sets the tick's `mode` tag — `audit`, `derive`, or `maintain` (when inbox-drain and unblock-promote are the only meaningful dimensions).

**Default posture: research-leaning** — see `.claude/rules/collaboration.md` (*Inform before parking*) before logging an open question.

## Dimensions

**Audit (commit-delta).** Trigger: at least one commit in `<commit-delta>`. The window is the **audit stamp in `<state>`**, not the last `plan:` commit — plan can commit without auditing (a derive tick, a maintain tick, a cut that fell elsewhere), and keying on the commit would advance the window past commits nobody audited, permanently. The stamp advances only where auditing actually reached; see *Artifact discipline*. For each commit, cross-check the diff against the `per.section` it cites. Look for spec drift, missed cases, undertested logic, scope creep beyond `entry.files`, gate-bypass. Findings route to pending entries (with `per` cite), open questions (when human input is needed), or accepted-debt (one-line in commit body). **Do not write to inbox.md** — that's an external-contributor surface.

**Derive (spec-delta or bootstrap).** Trigger: `<spec-delta>` shows changes, OR there is no derive stamp yet. The window is the **derive stamp in `<state>`**, not the last `plan:` commit — plan can commit without deriving (a maintain tick, a cut that fell elsewhere), and keying on the commit would advance the window past a spec change nobody acted on, permanently. The stamp advances only where derivation actually reached; see *Artifact discipline*. Decompose changed or added spec sections into pending entries. Each entry: `per.section` matches the heading verbatim (no `## ` prefix), `files.{new,edit,retire}` are exact paths verified against build's `writablePaths`, `blockedBy` is set if a prior entry must ship first, `acceptance` is one line that turns green. `files` is a **prediction the scheduler consumes, not a permission** — where build may write is
`phase.writablePaths` in the chain, never an entry's business (`spec/pending.md`, *`files` is a
prediction the scheduler consumes*). Declare the paths the work will actually touch: exactly
those, neither defensive nor aspirational.

- **Exact paths, never globs.** The partitioner intersects declared paths as literal strings, so
  a declared `tests/**` collides only with another literal `tests/**` and hides the real
  collision underneath it. Name `tests/Dispatcher.test.ts`, not the glob.
- **Include the test files the work touches.** Two entries editing the same test file genuinely
  collide and *should* serialize; two editing different ones should not. Only exact declarations
  let the partitioner tell those apart.
- **Over-declaring costs wave width** — the partition treats every shared path as a collision.
  Measured across 171 historical queues at `maxParallel: 4`: mean first-batch width was 1.99 as
  declared, 3.17 with the one path that had entered substantially every entry removed, and 94 of
  those queues were serialized to width 1 outright. **Under-declaring** costs at most a
  cherry-pick conflict, which the dispatcher aborts and leaves pending for a retry.
  > The write guard narrows to declared files on a scoped tick (this chain declares
  > `scopeWritesToEntry: true`), so an under-declared path also reverts the commit. Accuracy
  > satisfies both.

**Tests ride the entry**: an entry that ships engine behavior carries its test coverage in the
same entry — one line in `tests[]` per behavior the work must pin, stating the behavior only.
Which file a test lands in is build's call, so it belongs in `files` (as an exact path) and never
in `tests[]`. Never a follow-up entry the audit has to file (operator ruling 2026-07-28: five
`-TESTS` follow-ups in one line is a derivation defect, not diligence). Decompose into discrete, shippable units. If a single section would require many large entries, that's a signal the section is too broad — file an open question proposing a spec split instead.

**Drain (inbox).** Trigger: `<inbox>` non-empty. Each entry routes to one of: pending entry (with `per` cite), open question (parked), or accepted-debt (one-line in commit body). Remove drained entries; preserve the `inbox.md` header. The inbox is a queue, not a log.

**Promote (unblock).** Trigger: any entry in `<pending-now>` with `gate.kind === "blockedBy"` any of whose `gate.tags` is no longer a tag in `<pending-now>`. Remove the landed tags from the list; when the list empties, flip the entry to `gate.kind: "open"`. This is mechanical — process all of them.

**Sweep (posture).** Trigger: commits past the `Posture swept through:` stamp in `<state>` touch the sweep domain (`src/`, `tests/`, `bin/`, `examples/`) or a posture page (`.claude/rules/{engineering,engine-boundary}.md`). Apply the posture pages to code that already exists — a ratified phrase governs nothing until it is swept. Mechanics, frontier, cursor, and stamp: `.claude/rules/posture-sweep.md`, which binds this dimension. One neighborhood per tick, and only on a tick where `<pending-now>` carries no pickable entry — the sweep yields to pickable work: while entries are pickable, hand off to build and leave the rotation untouched in `<state>` (frontier and cursor persist; coverage is deferred, never lost). An open rotation sets `Plan continues: yes` only once the queue is drained; quiet-on-clean advances the stamp alone.

## How much to do this tick

Each dimension is processed *to its quality bar*, not to a count. Audit deeply enough to catch real drift. Derive entries telegraphic enough that build can act mechanically. Route inbox entries you can route cleanly; leave the rest for next tick rather than guess.

If the delta is small enough that you can meet the bar across every dimension, do so. If a dimension is too large to process fully without diluting quality, take the slice that matters most — the commits that touched the most consequential surfaces, the spec sections that gate the most downstream entries, the oldest inbox entries that have been waiting — and set `Plan continues: yes — <which dimension overflowed>` in state.md. The harness re-wakes plan; the next tick takes the next slice. You decide where the cut falls.

## Always-on (every tick)

- **Verify writable paths** for entries you touched this tick. Off-allowlist file paths become open questions proposing chain.ts amendments, not pending entries.
- **Re-derive state.md from scratch**, to the contract in *Artifact discipline* below. **Final line is mandatory: `Plan continues: yes — <one-line reason>` OR `Plan continues: no`.** The harness re-wakes plan iff `yes`; absence is treated as `no`.

## Field discipline

`files[].description`, `tests[]`, `acceptance`, and `notes` are pointers, not spec restatements (per `.claude/rules/collaboration.md` — *Match prose to the medium*). If `description` reads like *"Add X: if input matches /pattern/ then…"*, you're duplicating the spec; the right shape is *"Widen X per §N."* The `per` cite is the reader's path to mechanics — trust it.

Telegraphic: short enough that build can act on the entry without re-reading the spec.

**Hard caps (zod-enforced; over-cap reverts the whole tick via the pending gate, no partial credit):** `summary` ≤200 chars, `notes` ≤500 chars. Not soft. `files[].description`, `tests[]`, and `acceptance` are uncapped — there ≤200 chars is the calibration anchor, not a gate.

## Artifact discipline

Every file you write is re-injected verbatim into future ticks — size is a per-tick token tax, paid every tick until the content leaves. **Git is the log; the files are the present.** A done item leaves the file; its narrative lives in the `plan:` commit body.

- `open-questions.md` — open questions only. Closing a question means **deleting its section**; the disposition goes in the commit body. No closure ledgers, no "closed this tick" comment blocks, no history — delete any you find. Steady state with nothing open: the header alone.
- `state.md` — **only what has no other home on disk.** Every other fact you might put here is already injected into this prompt verbatim from the artifact that owns it: the queue from `<pending-now>`, the questions from `<open-questions>`, the commits and HEAD from `<commit-delta>`. Restating any of them is a second copy of one truth (`.claude/rules/engineering.md` — *Derived state is computed, never restated beside its source*), and it goes stale against the source it paraphrases. Exactly five things qualify — three cursors, the rotation's covered set, and the handoff line:

  1. **`Posture swept through: <sha>`** — copied forward *verbatim*, advanced only when a rotation closes. Losing the line re-arms the whole domain; guessing a sha is worse. If `<state>` carries no stamp, this is the bootstrap sweep: stamp `HEAD` and say so in the commit body.
  2. **`Spec derived through: <sha>`** — the derive cursor `<spec-delta>` diffs from, copied forward *verbatim* and advanced **only** to a sha whose spec changes this tick actually derived into entries, or judged in the commit body to need none. Never advanced as bookkeeping: a tick that sees a spec change and doesn't derive it must leave the stamp where it is, or the change becomes invisible to every later tick. Advance it to the sha you derived *through*, not reflexively to HEAD — a spec commit landing mid-tick is exactly the race this stamp exists to survive. Losing the line re-derives the whole corpus; a stamp that doesn't resolve makes `<spec-delta>` refuse, and the repair goes in the commit body.
  3. **`Audited through: <sha>`** — the audit cursor `<commit-delta>` lists commits from, on the same contract as the derive stamp above: copied forward *verbatim*, advanced **only** to a sha whose commits this tick actually cross-checked against their `per` cites, or judged in the commit body to need none. A tick that takes a slice and sets `Plan continues: yes` advances the stamp **only through the contiguous audited prefix of the window, never to HEAD** — one sha cannot express "audited 3, 7, and 9", so a slice that skipped around advances to the last commit before the first one it skipped. The commits past that point re-appear next tick even where this tick already read some of them; **that re-showing is the safe direction and is intended.** Under-showing loses a commit permanently, so when the two are in tension, prefer auditing the window oldest-first — a prefix a stamp can actually express — over cherry-picking the most consequential commits out of the middle. Never advanced as bookkeeping: plan commits on derive, maintain, and sweep ticks that audit nothing, and every one of those must leave the stamp where it is. Losing the line falls the window back to the last `plan:` commit (bootstrap, announced in `<commit-delta>`); a stamp that doesn't resolve makes `<commit-delta>` refuse, and the repair goes in the commit body.
  4. **The open rotation's covered set** — which modules this rotation has already swept. Settled for the window, and recorded nowhere else. Omit entirely when no rotation is open. Don't also list the remaining frontier: it is the domain minus this set.
  5. **`Plan continues: yes — <reason>` / `Plan continues: no`** — final line, mandatory, read by the harness.

  Plus, rarely, a cross-tick note the next tick genuinely needs that no artifact carries. No queue listing, no question listing, no HEAD sha, no mode line, no phase narrative, no per-dimension trigger report — **this tick's story goes in the commit body.** Steady state with no rotation open is about seven lines.
- `inbox.md` — drained means deleted (already the contract).
- `pending.json` — entries only; shipped entries are removed by the harness.

A cap overrun almost always means the entry is **restating the spec instead of pointing at it**. The spec holds intent and mechanics; a plan entry points into it — `do X per §N`, `widen Y per §N` — sized so build acts without the entry re-explaining the spec. The fix is to **point harder, not shrink the spec**: cut restated mechanics, trust the `per` cite. Decompose into more entries only when one genuinely bundles several independent shippable units. A spec-split open-question is a last resort — for a section enumerating many unrelated deliverables, never for a section whose intent is merely rich; the spec is sized for intent, not for plan's character budget. Downstream cost is real: every build tick re-reads the full entry JSON; bloated fields tax every tick until the entry ships.

# OUTPUT

Commit all changes in one commit prefixed `plan:`. **Body opens with `mode: <audit|derive|maintain>`** followed by narrative — which dimensions of the delta you processed, what you routed where, what you accepted as debt, where you set the cut if you didn't cover everything. Write:

- `.flume/plan/pending.json` — JSON array conforming to the schema below.
- `.flume/plan/state.md` — markdown, ending with `Plan continues: yes|no`.
- `.flume/plan/open-questions.md` — markdown.
- `.flume/inbox.md` — drained entries removed; preserve the header.

The harness will reject your commit if `pending.json` doesn't parse, or if you modify anything outside the phase's writable paths.

For `per.path`, use the file each section was derived from — one plan round may span multiple release specs (e.g. an older line winding down while a newer one is active). Two citable corpora, both human-authored:

- `spec/*.md` — the engine contract by topic (`loop`, `chain`, `prompt`, `pending`, `cli`, `jobs`, `worktrees`). The default for Derive and most Audit findings.
- `.claude/rules/*.md` — what shape it takes. Sweep findings and shape defects cite the owning rule section (`engineering.md`, `engine-boundary.md`); these need no release-line home, which is what unblocks shape work between lines.

For `per.section`, use that file's exact section heading text without the leading `## `. The `per` cite must resolve in the file it names.

<schema>
{{PENDING_SCHEMA}}
</schema>
