# statusVerb now spells one refusal leg five times

Landed: the queue read gained the guard its four siblings had, so all five
reads in `statusVerb` (`src/cliStatus.ts`) now refuse `EX_IOERR`. With the
fifth in place the shape is legible: five legs spelling the same three
steps — try the read, log one "[flume] status: <subject> at <path> failed to
read: <thrown message>" line, return the io-error code — differing only in
the subject word and the path accessor. That is `engineering.md`, *A module is
one job* — "a second copy of a sequence ... is one function with two
callers" — at five copies, and the sentence template is itself the
vocabulary spelled five ways. Correctness-adjacent in one direction only: a
sixth read added without the leg is exactly the defect this entry fixed, and
nothing mechanical catches the omission. Debt, not a queue entry, unless
plan judges the omission risk to be the correctness arm.

Second observation, for whoever writes the next unreadable-queue fixture:
`denyFile` (`tests/helpers/denial.ts`) cannot deny a queue *entry*.
`readQueueOnDisk` (`src/pendingLedger.ts`) filters `!d.isDirectory()`, so the
directory `denyFile` plants at `A.json` is dropped from the listing and the
read answers the empty queue — a case armed that way passes over a read it
never made. A self-referential symlink at the entry path is the one that
bites (ELOOP at `readFileSync`), and the new test uses it. The helper's
doc-comment rule ("deny the read path, never a parent") is right and still
insufficient here, because the reader filters by dirent kind before it
reads; worth a sentence in that helper if plan wants it homed.
