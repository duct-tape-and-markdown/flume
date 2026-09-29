# The field still says `inFlight` after the line stopped saying it

Shipped: the spend line's trailing clause now reads `N agents started with
no usage row yet, spend this total does not carry`, in `src/cliStatus.ts`,
`docs/CLI.md`'s status section, and the test that titles the claim. No
derivation moved.

Two things for the next plan tick:

1. `RunSpend.inFlight` (`src/runSpend.ts`) is the name the operator wording
   just stopped using. Its doc comment already words the fact correctly, so
   nothing is wrong on disk — but the field name is now the only place the
   old liveness vocabulary survives, and it is what a chain author reads on
   the hover text. A rename to something the field's own doc already says
   (`unrowed`, `startedWithoutRow`) is a mechanical one-call-site change:
   `src/cliStatus.ts` is the only reader, and no test names the field — the
   suite asserts the printed line. Not
   filed here because the entry's acceptance fenced `RunSpend.inFlight` as
   untouched, and a rename is the kind of surface decision plan should make
   deliberately rather than a build tick taking on the way past.

2. `docs/CLI.md` line 39's status sentence is now around 25 clauses long and
   carries the exit-code range, the chain-load degradation, and the spend
   line in one breath. It is the surface the `cliHelp` doc pins read against,
   so it is load-bearing prose, not decoration — but every entry that touches
   status prose collides on this one line (this tick seamed with
   A-COUNT-FLAG-TAKES-A-DECIMAL-INTEGER-OR-REFUSES on it). Splitting the
   status section into sentences per printed row would cut that collision
   surface without changing what it states.
