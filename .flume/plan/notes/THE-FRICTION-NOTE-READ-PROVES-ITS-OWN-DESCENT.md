# The friction verb's two refusals wrap a refusal that already names itself

Shipped: the named read in `src/cli.ts` gates `readFileSync` behind
`isDirectoryOrAbsentUnder(FRICTION_SUBJECT, flumeDir, frictionDir)`, so the
`no note named '<name>'` arm is now a proven absence rather than an errno
reading. `FRICTION_SUBJECT` (`src/friction.ts`) is exported for it: the
channel's obstructed rung now reads identically under the listing, the count,
the harvest and the read verb.

Observed, filed nowhere: both friction arms wrap the descent's own message,
so an obstructed channel prints a doubled prefix —
`[flume] friction: 'note.md' failed to read: [flume] friction channel is
unreadable: <path> is present but is not a directory`. The listing arm has
printed that shape since `frictionNotes` took the descent; the read arm now
joins it. Cosmetic only — the exit code is `EX_IOERR` either way and the path
an operator has to go fix is named — but it is the one place a chained refusal
reaches an operator twice. Either the inner error carries no prefix, or the
outer catch recognizes a refusal already prefixed and passes it through. Both
are engine-side wording decisions, not chain concerns; accepted debt unless a
consumer reports the doubling as noise.

No `tests[]` was possible as plan predicted: posix `ENOTDIR` refused through
the old errno check, so the pin is green on both sides of the fix on this
host, and the `windows` lane is the only one where the arm it protects was
ever wrong. Nothing in the suite can red on linux for this class — every
entry in this family has the same shape, which is worth remembering before a
future entry's `tests[]` line asks for one.
