# A read-only verb still writes into the default state root

Shipped: the second-root evidence is now a runtime-owned name that *holds*
something. `holdsState` (`src/cliStateDirs.ts`) answers true for a file
(flag, lock, verdict log — standing is the whole of what it carries) and for
a directory only when it has an entry. The bay listing went away with it: the
find stats each `STATE_ROOT_NAMES` entry directly, so there is one probe per
candidate and no set to keep in step.

Two things the next plan tick may want.

1. **The upstream oddity is untouched.** `flume status` is a read verb and it
   still mkdirs `<flumeDir>/awake/` on its way to reading the baton — the
   `Baton` constructor does it unconditionally (`src/Baton.ts`). This entry
   made the *evidence* immune to it; nothing stopped the write. Any other
   reader that keys on the presence of a runtime directory inherits the same
   trap, and a fresh clone gets a dirtied bay from one `flume status`. A
   construct-for-read path that does not create is the mechanism-level fix
   (`.claude/rules/engineering.md`, *The fix lands at the mechanism*); I did
   not take it, because it is a `Baton` contract change well outside this
   entry's acceptance.

2. **Docs moved with the behavior.** `docs/CLI.md` and
   `docs/CHAIN-AUTHORING.md` both stated the refusal keys on "a baton, a
   worktree base, a verdict log". Both now say a runtime name holding nothing
   is not that state, and name the `flume status` shape. `spec/jobs.md`, *The
   checkout is the unit of isolation* says "has already written into", which
   this reading now matches rather than approximates — no spec edit needed.

The refusal fixture `checkoutHoldingState` (`tests/cliStateDirs.test.ts`)
plants its flag through the real writer (`Baton.wake`) now, not a bare mkdir,
so every refusal case in that suite rests on state something really wrote.
