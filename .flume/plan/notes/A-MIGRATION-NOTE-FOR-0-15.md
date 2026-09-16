# 0.15's Breaking list is missing a break it shipped

`TickResult.quarantinedTags` went `readonly string[]` -> `readonly
QuarantinedTag[]` at 0.15 (v0.14.0 src/Phase.ts:198 vs v0.15.0
src/Phase.ts:288), but 0.15.0's changelog files it under `### Added`, not
`### Breaking`. The note walks it (§ 5.6) and says so out loud; the released
section is untouched, since rewriting a shipped release's Breaking list is a
human call. If the answer is "amend it", that is a one-line entry.

Second: the packaging suite's note-series check had only a blanket
`spanning.length > 0` guard, which this entry's note empties. Replaced with
two arms — coverage (every minor whose section carries `### Breaking`, from
the earliest note upward, has a page: populated, n=7, and red on the pre-fix
tree) plus the notice loop followed by a spelled `toEqual([])`. A minor cut
with no breaks and no page repopulates `spanning` and the equality is the
cue. New helper `breakingMinors` reads the section bodies.
