# Plan discipline — what every plan slice holds to

Not injected into any tick. Each slice prompt points here; read it before writing `.flume/plan/pending.json`, `.flume/plan/state.md`, or `.flume/plan/open-questions.md`. One home for the rules the four slices share; `.flume/PROTOCOL.md` holds what an entry carries and what makes one good.

## Fields point, never restate

`files[].description`, `tests[]`, `acceptance`, and `notes` are pointers, not spec restatements (`.claude/rules/collaboration.md`, *Match prose to the medium*). "Widen X per §N", never "Add X: if input matches /pattern/ then…". The `per` cite is the reader's path to mechanics — trust it. Telegraphic: short enough that build acts without re-reading the spec.

**Hard caps, zod-enforced — an overrun reverts the whole tick via the pending gate:** `summary` ≤200 chars, `notes` ≤500. A cap overrun almost always means the entry restates the spec instead of pointing at it. Point harder; never shrink the spec. Decompose only when one entry bundles several independently shippable units.

`per.path` names the file the section lives in — `spec/*.md` for the engine contract, `.claude/rules/*.md` for shape — and `per.section` is that file's exact heading text without the leading `## `. The `per cites resolve` gate refuses a commit whose cite does not resolve.

## `files` is a prediction the scheduler consumes, not a permission

Where build may write is `phase.writablePaths` in the chain (`spec/pending.md`, *`files` is a prediction the scheduler consumes*). Declare exactly the paths the work will touch, tests included — as exact paths, never globs: the partitioner intersects literal strings, so a declared `tests/**` collides only with another literal `tests/**` and hides the real collision. Over-declaring costs wave width (measured over 171 queues at width 4: mean first batch 1.99 as declared, 3.17 with one over-declared path removed); under-declaring reverts the commit on the scoped fence. Accuracy satisfies both. Verify every path against build's `writablePaths`; an off-fence path is an open question proposing a chain amendment, never an entry.

**Tests ride the entry, and the gate reads them.** One `tests[]` line per behavior the work must pin, written as the title of the test that will pin it: present tense, one decidable behavior, no trailing period — build titles a passing test with the line verbatim and the `vitest` gate proves each line has one. A line no test could be titled with ("error handling is better") is not a behavior. The file it lands in is build's call and belongs in `files`. Never a follow-up `-TESTS` entry.

## Artifacts are the present; git is the log

Every file here is re-injected into future ticks, so size is a per-tick tax paid until the content leaves. A done item leaves the file; its narrative lives in the `plan:` commit body.

- `open-questions.md` — open questions only. Closing one deletes its section. No ledgers, no "closed this tick" blocks. Steady state with nothing open is the header alone.
- `state.md` — exactly the two cursor lines (`Spec derived through:`, `Posture swept through:`) and, while a posture rotation is open, a paragraph beginning `Rotation open` carrying its covered set. Nothing else: no queue listing, no HEAD sha, no narrative, no continuation marker. A slice edits its own cursor and leaves every other byte identical. A cursor advances only to a sha the slice actually processed through — never as bookkeeping, never reflexively to HEAD — and is copied forward verbatim otherwise. Losing a line re-arms the whole window; a sha that does not resolve makes the slice's window refuse, and the repair goes in the commit body.
- `inbox.md` — drained means deleted; the header stays.
- `pending.json` — entries only; the harness removes shipped entries.

## Closing a slice

Before the commit, every slice:

1. **Promotes.** Any entry with `gate.kind: "blockedBy"` whose tags are no longer in the queue: remove the landed tags; when the list empties, flip to `open`. Mechanical — all of them.
2. **Verifies** every entry it touched: paths against build's fence, `per` resolving in its file.
3. **Commits once**, prefixed `plan:`. Body: what was routed where, what was accepted as debt, where a cut fell. The harness rejects a commit whose `pending.json` does not parse, whose cites do not resolve, or that touches anything outside the phase's writable paths.
