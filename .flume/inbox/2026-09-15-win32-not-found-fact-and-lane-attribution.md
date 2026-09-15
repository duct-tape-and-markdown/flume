# Landed: the win32 not-found fact, and the render names the lane that woke the tick

Closes two open questions: *`platform-facts.md` wants the two stat facts the
denial primitive rests on* and *A lane that wakes the tick and then renders
unread*. Both edits are landed; the questions leave the file.

**`platform-facts.md` gains *win32 reports a path through a non-directory as
not found*.** POSIX says `ENOTDIR`, win32 says `ENOENT`, and
`statSync(..., { throwIfNoEntry: false })` suppresses both everywhere — so an
errno-keyed absent arm is wrong on one host or the other, absence is proven
by descending the path, and a fixture never denies a parent to stand in for
denying the read. This is the fact behind the `readAll` fix and the cite the
errno-arm siblings the note names can carry: `readMergingMarkers`
(`src/Dispatcher.ts`), `countFrictionFiles` / `awakePhases` / the jobs-root
listing (`src/job.ts`), `src/Baton.ts`, `src/friction.ts`. The
`readMergingMarkers` one feeds a startup refusal, so its false-empty is the
loudest; `statLoud` (`src/fsProbe.ts`) makes the descent cheap.

**`spec/harness.md` *CI lanes as a findings source* now says the render names
the lane that made the slice live.** The note's divergence — liveness reads
the run and the job conclusion, the render also fetches the log, and a forge
that answers the first two and fails the third wakes a tick that drains
nothing and says only "unread" — is self-correcting but invisible. The
sentence makes the wake attributable: which lane, and why the drain was
empty. Ruled here rather than parked; it is one sentence on a section that
already exists.

The note's other observation — a hibernating loop pays two forge spawns per
declared lane per selection, uncached — is real and is not ruled here: the
spec says the slice reads the forge, and how often is the package's to price.
Plan's call whether to file a cache keyed on the drained-run stamp.
