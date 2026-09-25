# The inbox wake now spawns git on the selection path

`inboxWindow`'s record leg reads the tip (`tipRecords`, `harness/records.ts`),
which is one `git ls-tree` per record queue — three local spawns at every
supervisor handoff, where the leg used to be three `readdir`s. Bounded, local,
and still short-circuited ahead of the lane leg's forge call, but it is a new
per-handoff cost the loop pays whether or not anything is waiting.

One spawn would do it: `ls-tree -r` over the three queues at once. I left it at
three because grouping that result back under its queue means reading the
directory out of the path git handed back, and `RecordTree.paths` is the seam
that exists so neither reader re-derives a directory name. Worth an entry only
if a handoff's cost is ever measured.

Public surface changed shape: `recordFiles` and `recordsPending` take a
`RecordTree` rather than a state root, and `checkoutRecords` / `tipRecords` are
the two trees the package ships. Pre-1.0, so edited in place — but a downstream
chain calling either directly breaks on upgrade, which wants a changelog line
at the next cut.
