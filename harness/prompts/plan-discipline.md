# Plan discipline — what every plan slice holds to

Not injected into any tick: each slice's prompt names this file's path, and you open it once before writing the queue, the plan state artifact, or the open-questions file. One home for the rules the slices share; `PROTOCOL.md` holds what an entry carries and what makes one good. Every path this page speaks of by name is spelled out in the `<artifacts>` block of the slice prompt that sent you here.

## Fields point, never restate

`files[].description`, `tests[]`, `acceptance`, and `notes` are pointers, not spec restatements. "Widen X per §N", never "Add X: if input matches /pattern/ then…". The `per` cite is the reader's path to mechanics — trust it. Telegraphic: short enough that build acts without re-reading the spec.

**The caps the schema block states are enforced by the queue's schema — an overrun reverts the whole tick.** A cap overrun almost always means the entry restates the spec instead of pointing at it. Point harder; never shrink the spec. Decompose only when one entry bundles several independently shippable units.

`per.path` names a file inside the declared spec locus, and `per.section` is that file's exact heading text without the leading `#`. The `per` gate refuses a commit whose cite does not resolve there. An entry that cannot carry a clean cite is an open question, not an entry.

## `files` is a prediction the scheduler consumes, not a permission

Where build may write is its phase fence, and that is the whole fence: build is not held to `files`. You state the architecture; build decides which files carry it. `files` is your best prediction of where the work lands, read by the fanout partitioner alone — as exact paths, never globs: the partitioner intersects literal strings, so a declared `tests/**` collides only with another literal `tests/**` and hides the real collision. Over-declaring costs wave width (measured over 171 queues at width 4: mean first batch 1.99 as declared, 3.17 with one over-declared path removed); under-declaring costs at most a cherry-pick conflict, which the dispatcher retries from the new base. Predict honestly and move on; never pad. Verify every path against build's fence; a path outside it is an open question proposing a fence amendment, never an entry.

**Tests ride the entry, and the judge reads them.** One `tests[]` line per behavior the work must pin, written as the title of the test that will pin it: present tense, one decidable behavior, no trailing period — build titles a passing test with the line verbatim and the judge proves each line has one. A line no test could be titled with ("error handling is better") is not a behavior. A `tests[]` line names a behavior the entry **introduces or changes**: the judge also runs each named test against the pre-fix tree and refuses one that already passes there. That base run lays the merged bytes of the files holding the named tests over the pre-fix tree, so a line is judgeable only when the entry **also changes a file that is not one of those** — an entry whose whole diff is the files carrying its own tests rebuilds the change at the base and passes there by construction, whatever it pins. Such an entry declares its behavior somewhere else or carries no `tests[]` line at all. A property that **already holds** and gains its check in this entry — an agreement pin, a doc-to-source scan — goes in `pins[]` instead: same title discipline, judged green only. A `tests[]` line the judge reports as already green on the base is yours to move to `pins[]` or drop; build cannot. The file a test lands in is build's call; predict it in `files` when you can name it. Never a follow-up `-TESTS` entry.

## Artifacts are the present; git is the log

Every artifact here is re-injected into future ticks, so size is a per-tick tax paid until the content leaves. A done item leaves the file; its narrative lives in the `plan:` commit body.

- **The open-questions file** — open questions only. Closing one deletes its section. No ledgers, no "closed this tick" blocks. Steady state with nothing open is the header alone.
- **The plan state artifact** — three typed fields: `derivedThrough` (the sha the spec has been derived through), `sweptThrough` (the sha the posture frontier was derived from), and `rotation` (`closed`, or `open` carrying the covered set the sweep has settled). A slice edits its own field and leaves every other one byte-identical. A cursor advances only to a sha the slice actually processed through — never as bookkeeping, never reflexively to HEAD — and is carried forward verbatim otherwise. The artifact is refused outright if a field is missing, so there is no "no cursor" state to fall back into: a slice with nothing to advance writes back the cursor it came in with. A sha that does not resolve makes that slice's window refuse, and the repair goes in the commit body.
- **The record queues** — one file per record; a routed record is `git rm`'d. Plan never creates one: the records gate refuses a plan commit that does.
- **The pending queue** — entries only; the harness removes shipped entries.

## Closing a slice

Before the commit, every slice:

1. **Promotes.** Any entry with `gate.kind: "blockedBy"` whose tags are no longer in the queue: remove the landed tags; when the list empties, flip to `open`. Mechanical — all of them.
2. **Verifies** every entry it touched: `files` paths against build's fence, `per` resolving in its file.
3. **Commits once**, prefixed `plan:`. Body: what was routed where, what was accepted as debt, where a cut fell. The harness rejects a commit whose queue does not parse, whose cites do not resolve, or that touches anything outside the slice's writable paths.
