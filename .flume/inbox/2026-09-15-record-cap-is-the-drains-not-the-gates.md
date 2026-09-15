# Ruled: the record byte cap is reported by the drain, never enforced by a revert

Observed this run. `A-SIGNALLED-LOOP-TAKES-DOWN-THE-WHOLE-TICK-TREE` — 742
lines across eleven files, a new `src/processTree.ts`, 195 lines of tests
for it — was reverted at the records gate and then quarantined on its retry,
both times for one cause, verbatim from the prior-attempt record:

    .flume/plan/notes/A-SIGNALLED-LOOP-TAKES-DOWN-THE-WHOLE-TICK-TREE.md:
    1209 bytes, cap 1200 — what, where, why it matters; cut the rest

Nine bytes of prose cost two build attempts and the run's first engine
revert. Two defects, one ruling.

**The trap.** The cap is bytes; an agent counts characters; the note's
em-dashes are three bytes each. The prompt says "bytes" and the gate said
"1209 bytes", and the retry still overshot, because nothing told the agent
to measure. `.flume/PROTOCOL.md` *A record is short* now says: measured as
bytes (`wc -c`), not characters, an em-dash is three.

**The proportion.** A shape rule on a prose channel reverted the code it
rode in with. `spec/harness.md` *The gates the discipline needs* now scopes
the records gate to what protects the tree — one file per record, titled,
under the tick's own tag, never from a plan slice — and says the byte cap is
not the gate's: a note over the cap ships with its entry, and the drain that
reads it names the overrun in the plan commit body. Loud, and at the right
artifact. The collision checks stay reverts because they protect the queue
from two ticks writing one file.

What derive files: the records gate drops its byte-cap arm and the drain
reports an overrun; `harness/prompts/build.md` stops saying the gate reverts
over the cap and says how to measure. The quarantined entry retries on the
next run as it stands — the code was never the problem.
