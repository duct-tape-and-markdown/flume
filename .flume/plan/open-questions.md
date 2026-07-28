# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Engine-ownership requests from centercode-platform's chain (PARKED)

**Status:** PARKED — no spec authorizes this work; needs a human decision on
whether/how to scope an engine-hardening line before plan can derive entries.

**Context:** `.flume/inbox.md` carried four requests (routed out of inbox this
tick, parked here instead) from centercode-platform PR #670: chain code
deleted in favor of "the engine should own this truth." All four are real
(cited evidence, not speculative), but each is a `src/` architecture change
with no citable `spec/RELEASE-*.md` section — plan cannot originate a pending
entry without one (`spec-plan-build.md`: spec is human-authored; plan derives,
it doesn't invent). Recommend: author a `spec/RELEASE-v0.7.md` (or fold into
whatever the next line is) scoping which of these ship and in what order.

1. **Engine validates pending.json against its own schema at plan-commit
   gate.** Kills ~30 hand-rolled lines per chain (`parsePending` already
   exported). Evidence: caught a real malformed-pending revert in
   centercode-platform's 2026-07-24 rehearsal.
2. **Engine pre-checks planned entry paths against the next phase's
   writablePaths, at plan commit.** Same law the build-time write guard
   already enforces; a second hand-rolled glob matcher risks drifting from
   the engine's own semantics (centercode-platform carried and then cut a
   duplicate).
3. **`GateContext` exposes `repoRoot`.** Smallest of the four — kills a
   `git rev-parse --show-toplevel` + fallback helper every gate reinvents.
   Lowest risk, no behavior change, good first candidate if the line gets
   trimmed.
4. **A tick that throws halts the loop; `flume job run` propagates non-zero
   when it shipped nothing because ticks failed.** Currently a chain that
   can't load burns every tick in a `--max` run and still exits 0 — real
   product risk (silent CI green on a dead chain). Needs a design call: what
   distinguishes "ran, settled" (0) from "couldn't run" (non-zero), and
   whether "halts the loop" means the whole `job run` or just that tick's
   supervisor iteration.

**Options:** (a) one `spec/RELEASE-v0.7.md` covering all four as an
engine-hardening line; (b) ship #3 alone as a same-line micro-patch (lowest
risk, smallest surface) and spec the rest separately; (c) decline some/all as
out-of-scope for flume's engine and leave them as chain-level conventions
documented in centercode-platform instead. No recommendation forced — #2 and
#4 both touch dispatcher/loop semantics non-trivially and deserve scoping
before any code lands.

**Update (this tick):** `spec/RELEASE-v0.6.2.md` shipped the *teardown* half
of the dev-9175-cim-usage finding (friction/evidence surviving worktree
death — see `FRICTION-REVERT-NOTE` in pending.json) but explicitly declines
the *plan*-addressed half: persisting a reverted entry's offending-path list
+ commit message somewhere `plan` itself reads (§5: "entangles pending.json
semantics and awaits the v0.7 scoping call"). Add as item **5** to the
requests above: **on an entry-scope afterCommit revert, persist the verdict
into a plan-readable location** — candidate shape from the original finding:
append to the entry's `gate.reason` in pending.json, or a sibling field. Same
law as #1/#2 (plan should read structured engine-verdicts, not reconstruct
them from operator prose); same blocker (no citable spec section, touches
pending.json's own schema). Folds into whichever of options (a)/(b)/(c) the
human picks for the line as a whole.

## CLI entry silently no-ops through a directory junction (PARKED)

**Status:** PARKED — root cause and a credible fix are both diagnosed (see
below); parking only because no `spec/RELEASE-*.md` section or
`.claude/rules/*.md` rule covers CLI-entry invocation correctness, so plan
has no `per` cite to file a pending entry against (`spec-plan-build.md`:
"If a candidate plan entry can't carry a clean `per` cite into the spec,
it's a question for a human").

**Context:** `src/cli.ts:806-808` —

```
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
```

When `dist/cli.js` is reached through a Windows directory junction (a real
shape: pnpm's linked store, `node_modules/@dtmd/flume` provisioning per
`spec/RELEASE-v0.5.md` §4, or any junction-based install), `import.meta.url`
resolves through the junction to the file's realpath while `process.argv[1]`
keeps the junction-relative path verbatim — the two never `===`, `main()` is
never called, and the process exits 0 having done nothing. Observed live via
DEV-9191 delivery. Same silent-success family as engine-ownership request #4
above (a chain that can't run still exits 0).

Not addressed by `spec/RELEASE-v0.6.2.md` (that line is friction lifecycle +
win32 teardown only) or by `spec/RELEASE-v0.6.1.md` §2 (that section fixed
the *shim's* shebang format, not this in-process invoked-directly check, and
v0.6.1 is shipped/frozen — not reopened here).

**Research done (per collaboration.md "inform before parking"):** this is
Node's well-known ESM equivalent of `require.main === module`; the standard
fix compares realpaths on both sides rather than raw argv, e.g.
`fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)`
(guarded for `argv[1]` being undefined, as today). No competing idiom found
worth presenting as an alternative — this is close to a one-option answer,
just missing a citable spec section to hang a pending entry on.

**Recommendation:** smallest-viable fix, no new architecture — either fold
as a short addendum section into a future patch spec (this repo's own
pattern: v0.6.1 was exactly this shape, a one-finding patch line) or approve
inline as spec-exempt (the fix is mechanical and low-risk enough that a
human could authorize it directly rather than round-tripping through a full
spec section). Either disposition unblocks plan next tick.

## Harness block states the wrong (unnarrowed) revert fence on entry-scoped ticks (PARKED)

**Status:** PARKED — this is a change to already-*documented* behavior
(`docs/CHAIN-AUTHORING.md` §5's own example shows the harness block listing
bare `phase.writablePaths`), not a straightforward bug fix — closing it
means deciding what the corrected block should say, which is a spec-shaped
call, not a plan-invented one. `spec/RELEASE-v0.4.md` §5 mandates the
*retry* feedback (`<prior-attempt>`) name the offending path after a
revert; it does not mandate the *pre-commit* `<harness>` block show the
narrowed fence up front — so there's no existing section this entry could
cite without stretching it.

**Context:** `prependHarnessBlock` (`src/Prompt.ts:218`) always renders
`phase.writablePaths` under "anything else you modify will revert the
commit," including on fanout ticks carrying an `assignedEntry`, where
`src/Dispatcher.ts:1056-1068`'s write guard actually narrows to
`entry.files ∪ entryChannelPaths` (`spec/RELEASE-v0.4.md` §5) — a strict
subset. The agent is told a wider fence than the one that will actually be
enforced. Field cost, per the finding: dev-9175-cim-usage agents worked
in-band against phase globs while the entry fence reverted them anyway;
centercode-platform PR #672 hand-wrote fence clarity into a chain prompt
that the engine should self-transmit; temper's build prompt still promises
"staying inside [phase paths] never reverts" — true on its 0.3.1-era
engine, false since the 0.4 entry-scoped guard shipped underneath it
unannounced.

**Fix shape proposed by the finding (plausible, not yet vetted against
call sites):** on a scoped tick, the harness block states the *effective*
fence — `entry.files ∪ channelPaths` as the revert boundary, phase globs
named separately as the outer ceiling — instead of collapsing both into
one `writablePaths` list. Open for a human to confirm before it's spec'd:
whether this makes the `<prior-attempt>` reactive detail partly redundant,
and whether `docs/CHAIN-AUTHORING.md` §5's own worked example needs
rewriting in the same pass (it currently teaches today's collapsed
rendering as correct).

**Recommendation:** small, self-contained, no schema/architecture
entanglement (unlike the two questions above) — good candidate for a
same-shape one-off patch spec (v0.6.1/CLI-junction pattern) rather than
folding into the larger v0.7 engine-ownership line, though it shares that
line's theme: this is the third "engine tells the agent something false"
finding parked this tick (alongside the CLI silent-exit-0 above and engine
request #4) — worth the human's eye as a pattern, not just three isolated
bugs.
