# The per-path skip inside snapshotReverted is still silent

Shipped: `snapshotReverted`'s catch (`src/priorAttempts.ts`) now warns
through the store's own `Logger` with the snapshot dir and the underlying
error; the revert path is otherwise untouched.

Observed while in there, not filed: the loop's own per-path skip one level
up is the same shape and still silent. When `git.readFileAtRef` returns
`null` the loop does `continue` with no log, and the comment beside it says
why that is not the catch's job — the listing and the head's tree disagree
about one path. That is a real degradation of the recovery artifact (a file
the operator will go looking for is absent) with nothing anywhere saying so,
and after this entry it is the *only* silent arm left on the path: the
whole-artifact failure now speaks, one missing file does not. A warn there
would be one line and would name the path. Whether it wants an entry per
`Loud or nothing` or is debt is plan's call — the arm is reachable only when
git's own two listings disagree, which no test on the tree drives today, so
a `tests[]` line for it would need a fixture that manufactures that
disagreement.

Also noted: the warn text is asserted against the message the real
`diffNameOnly` throws, captured in the test rather than re-spelled, so a
change to git's error surface cannot leave the assertion pinning a string
nothing emits.
