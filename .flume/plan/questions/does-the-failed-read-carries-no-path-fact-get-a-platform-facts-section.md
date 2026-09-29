# Does "a read that failed after the open carries no path" get its own platform-facts section?

From a build note (THE-PRIOR-ATTEMPT-READ-REFUSES-A-RECORD-IT-CANNOT-READ). The
store's new refusal states the record path itself, and the warrant for that is a
node fact whose only copies are five code comments. `CLAUDE.md` says that is the
wrong home — "a code comment carrying one is a copy the harness should own
instead, seen only by an agent that already opened that file" — but
`.claude/rules/platform-facts.md` is yours, not any autonomous phase's, so this
needs your ruling before anything moves.

## The fact

An fs failure raised **after the open succeeded** names no path: the errno
carries the fd's syscall, not the path the caller passed. `readFile` /
`readFileSync` on a directory rejects with `EISDIR: illegal operation on a
directory, read`, `syscall: "read"`, and `err.path` is `undefined` — no path in
the message either. A failure at the *open* is the opposite: `ENOENT` carries
`path` and spells it in the message.

So the split is **which syscall failed**, not which errno came back — which is
why it survives any host: an `EIO` mid-read, or a permission failure the open
did not catch, drops the path the same way.

Measured on a directory read: node 22 (the note's own measurement) and node
24.21 (this tick, this host).

## What the tree already does with it, by hand

Two consequences, each spelled at the sites rather than once:

- **A per-file read rethrows a path or the operator gets nothing to go fix.**
  `src/priorAttempts.ts:421` (the refusal `readRecord` raises), and
  `tests/cli.test.ts:511`, `:997` — both of the latter adding the operational
  half: "the refusal states the one it read or the operator gets a bare name
  under a state root that may be relocated."
- **A test asserts the reader's own refusal, never the errno.**
  `tests/priorAttempts.test.ts:369`, `:424` — "asserting the errno pins one
  host's accident."

## The fork

**(a) Its own section.** Recommended. It is node's behavior, host-independent,
and it retires when node starts attaching the path to a post-open failure.

**(b) A paragraph inside *win32 reports a path through a non-directory as not
found*,** which two of the copies already cite alongside. Cheaper, and the two
facts do meet at the same call — but that section's claim is one host's and
expires when win32 changes, while this one expires on a node change. Two expiry
predicates in one section is a section the sweep's expired-narration lens cannot
retire by halves.

Either way nothing pins it — an external tool's behavior lands as prose by
construction, like every other section on that page.

## What your ruling unblocks

Once a heading exists, the five copies shrink to a pointer at it. All five are
in `src/` and `tests/`, which build can write, so that is a queue entry the next
drain files — it cannot be written before the heading it has to name, because
the citation pin resolves the `*Section*` half against the page's real headings.

## Not part of this question

The same note flagged that `readTickVerdict`, `readTickVerdicts` and
`readLatestVerdictsSync` (`src/tickVerdict.ts`) all rethrow that pathless errno
bare, and that `flume status` and `flume log` then print it under the artifact's
bare basename. It was accepted as debt this tick, not filed: every one of those
paths is loud and exits `EX_IOERR`, so nothing is hidden — only the sentence is
thinner than the one `VerdictHistoryUnreadableError` gives the same log on the
write side. Raise it separately if you want the read side to match.
