# The spec section still opens "a directory of empty files"

`spec/loop.md`, *Baton — presence wakes, absence hibernates* — this entry's
own `per` — states both halves of a contradiction now that the token ships:

- para 1: "it is a directory of empty files: `<flumeDir>/awake/<phase>`"
- bullet 3: "A wake writes a fresh token into the flag"

A flag is no longer empty. The opening sentence is the human's to correct
(build never touches `spec/`), and it is the sentence a reader hits first, so
the stale half is the one that reads as authoritative. Nothing else in the
tree asserted emptiness — `docs/CLI.md`'s "empty file" lines are the *stop*
flag, not the baton, and every other baton reader is presence-only.

## The window the scoped sleep cannot close

Posix has no compare-and-unlink, so `Baton.sleepIfUnchanged` reads the token
and unlinks in two syscalls: a wake landing between them is still lost. The
window went from the whole tick (minutes) to two syscalls, and the failure is
recoverable (wake again) rather than corrupting, so it is declared at the site
and cited rather than fixed. Closing it fully wants either an atomic
rename-away — which leaves the flag *absent* for an instant, and
`hibernating()` reading that instant would stop a live loop, strictly worse —
or a per-token filename, which the name-is-the-phase layout `awake()` reads
forbids. Not worth an entry unless a measured loss shows up.

## Shape carried

`BatonToken` had to join `src/index.ts`: it is named by two public `Baton`
member signatures, and `tests/exportConsumers.test.ts` reds otherwise. Worth
knowing that any new public method's parameter type is an entry-module export
by that pin, not a judgment call.
