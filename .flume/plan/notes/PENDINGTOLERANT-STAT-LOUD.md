# readPendingTolerant's readFile is the next silent half

Shipped as written: `existsLoud` in a catch that warns then returns `[]`,
symmetric with the parse branch below it.

Observed while there: the `readFile` on the very next line is still bare. The
stat catch covers the case the entry named (ELOOP, permission-denied parent),
because stat fails first — but a path that stats fine and then fails to read
(EISDIR if pending.json is a directory, EACCES on the file's own mode, a
delete racing between probe and read) throws out of `readPendingTolerant` and
loses the `TickResult` the strict twin deliberately cannot lose. That is the
same "proceeds over an unresolved input" shape, one line down, and it is
louder-than-intended rather than silent — so it is a refusal where the
function's whole contract is *not* to refuse.

Suggest a follow-up entry folding the `readFile` + `parsePending` into the
same declared degrade: warn-then-`[]` for any read failure, not just the stat.
Scoped out here to keep the entry's `tests[]` line honest.
