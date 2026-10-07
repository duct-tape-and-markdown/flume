# The closed-reader door is armed for both streams; only posix drives it

Shipped at `src/cliOutput.ts`, called once from the `invokedDirectly` branch
of `src/cli.ts` — not module scope, so importing `src/` never attaches
handlers to an embedder's streams. Both stdout and stderr are armed, because
`2>&1 | head -1` closes one pipe carrying both.

Two things the next plan tick may want.

1. **The win32 half of `READER_GONE` is unexercised.** The set names `EOF`
   and `ECONNRESET` beside `EPIPE` and `ERR_STREAM_DESTROYED`, because win32
   reports a closed pipe as the first two. No case drives a closed stdout on
   the windows lane, so those two arms are prose with a set around them. This
   looks like a `laneTests[]` entry — lane `windows`, a title such as "a
   closed stdout on win32 leaves the verb's exit code intact" — written
   skipped elsewhere. I did not file it myself; it is a property, not a
   defect, and the lane is the only proof.

2. **`status` is the only verb that can refuse *inside* a listing.** Test
   three needed a verb that writes to stdout and then exits non-zero, and
   `status` (baton rows, then an unreadable queue) is the single one in the
   tree: `check`, `log`, `friction` and `render` each refuse before or
   instead of their listing. So "a refusing verb keeps its own code" has one
   driver today. The door is shared, so a verb that grows a mid-listing
   refusal inherits it — but nothing would red if the shared arming were
   narrowed to stdout-only or to `status` alone, which is worth knowing if
   this ever gets refactored.

No blocker. Full suite green (77 files, 2432 cases); all three `tests[]`
lines red on the pre-fix tree, verified by commenting out the one call.
