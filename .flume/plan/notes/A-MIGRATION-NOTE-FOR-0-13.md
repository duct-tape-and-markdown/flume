# The series pointers are part of every missing-note entry

Two minors still have no note: 0.14.0 and 0.15.0, both with a `### Breaking`
section. Scope the next two entries the way this one landed, not as filed.

Shipping 0.13's note falsified two live claims that had to move in the same
commit: `docs/MIGRATING-0.16.md` opened "each of the three minors between it
and this one shipped breaking changes with no note of its own" and closed by
naming `MIGRATING-0.12.md` as the previous note in the series; `README.md`'s
pointer list enumerated the earlier notes as `0.11`, `0.12`. The entry's
`files.edit` named only `CHANGELOG.md`. Each remaining note edits the same
three sites plus its neighbours — the 0.14 note becomes 0.16's predecessor
claim again, and 0.13's forward pointer ("0.14.0 and 0.15.0 ship breaking
changes with no note of their own") goes stale the moment either lands.

Also a lens: the notes are a linked list with no check on it. Nothing resolves
"the previous note in this series" against disk, so a wrong or missing
neighbour link ships green. The page names are pinnable (`commentCitations`);
the ordering claim is not.
