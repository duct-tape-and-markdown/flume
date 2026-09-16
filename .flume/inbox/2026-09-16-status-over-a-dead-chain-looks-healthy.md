# `flume status` over a chain that failed to load has the shape of a healthy one (pilot report from a win32 consumer on node 22, relayed by the operator)

After the stderr line naming the load failure, status prints `hibernating`
and `pending: 0` — byte-identical to a correctly adopted repo. A new
consumer's first command after init reports a harness that is not theirs.

Ruled at `spec/cli.md` *`flume status` owes exactly this*, item 6: the
failure is a row of the listing, `chain: failed to load — <reason>`, before
the pending count, on the same stream; exit stays 0 as specced. What derives:
the row, its test, and the existing "both observational surfaces still exit
0" case unchanged.
