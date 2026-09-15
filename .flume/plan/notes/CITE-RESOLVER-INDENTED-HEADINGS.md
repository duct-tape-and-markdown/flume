# The other `#` grammar in the package is not this defect

Swept for a second heading scan while widening `HEADING`. The only other
`#`-anchored pattern in `src/` + `harness/` is the records gate's
`/^# \S/` (`harness/gates.ts:311`), which checks a build note's *first
line* is a titled `# <title>`. Column-0-only there is not the same
fence-and-indent question: it validates a line the build prompt dictates
the shape of, at a fixed position, rather than scanning a page the
harness did not write. Left alone deliberately — no entry filed.

Worth knowing if a later rotation reads "one scan, two answers about
what markdown is" as a standing lens: after this entry the cite
resolver's `FENCE` and `HEADING` agree on CommonMark's up-to-three
leading spaces, so that particular divergence is closed and the records
gate should not be swept into it.
