# The built-ins list was short by three, not one

The entry named `chainLoadGate` as the missing built-in. Arming the
equality (walk of *Use the built-ins first* against the module's runtime
exports) reds on three: `pendingGate` and `shellGate` each led their
bullet with a call signature ("- `pendingGate({ targetFence, ... })` -"),
which no naming read on this page can see as a listing of the member. A
reader searching the page for the bare name found neither. Both bullets
now lead with the bare name and carry the signature in the body; the
sibling `shellGate`-composes pin's anchor moved with them.

Not shipped, and the one gap I would file next: the three sibling walks
on this page each pair the equality with a "names the set in one place"
case (`restatementsOf`, `tests/helpers/docSections.ts`). This section has
only the equality, so a second inventory in prose beside the bullets
would strand invisibly. The set here comes off a namespace import rather
than a TS interface, so `docWalk` (`tests/helpers/docWalk.ts`) does not
arm it - a members-supplied arm would give this page one reader for all
four walks.
