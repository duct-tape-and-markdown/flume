# No siblings: the host-native/git-alphabet mix was this one arm

Fold landed at the case as the entry called it: the queue arm is now
`gitPath(resolvePendingPath(STATE_ROOT))`, not `queuePath(STATE_ROOT)` —
`queuePath` is the fence's own accessor, so calling it would have made the arm
the fence agreeing with itself instead of with the resolver it is fenced
against (`.claude/rules/engineering.md`, *A seam gate reads what the real
writer wrote*).

Swept the suite for the same shape — an engine value composed with `node:path`
compared against a git-alphabet glob or diff line — and found none. Every other
`resolvePendingPath` caller in `tests/` wants the host-native answer for an fs
call (`harnessInit`, `cli`, `examples`, `harnessPrompts` `at:` accessors);
`paths.test.ts` already folds through `gitPath` at its own case. The
`matchesAny` calls in `harnessGates.test.ts` take hand-spelled forward-slash
literals, so no host composition reaches them.

The windows lane should be the only remaining proof; nothing local can red this
arm, which is why the entry carries no `tests[]`.
