# The removal's silent arm descends now, and the rest of the errno family is clean

Fix is one line in `removeUnderStateRoot` (`src/stateRootAccess.ts`): the
composed descent `isDirectoryOrAbsentUnder` (`src/fsProbe.ts`) from the state
root to the leaf's directory, inside the existing try. No write-side entry
point in `src/fsProbe.ts` was needed — the composition already is one, and the
leaf's own ENOENT past it is the proven absence.

The entry carried no `tests[]` on the reading that posix raises ENOTDIR and
already refuses. That is true of the exit code, but not of the refusal's
**detail**: pre-fix it is the errno's sentence, post-fix the descent's. Pinned
into the existing case "flume sleep over an unwritable awake-flag directory
refuses with the state-root write refusal" (`tests/cli.test.ts`), and verified
red on the pre-fix tree on this host. So the fix does ship a line that would
have caught it here, not only on the windows lane.

That case denies the flag's parent on purpose — the one converse
`.claude/rules/platform-facts.md`, *win32 reports a path through a
non-directory as not found* sanctions. Now said at the site, which it was not
before the descent made the denial load-bearing.

Swept the rest of the family while here: every other `code === "ENOENT"`
silent arm in `src/` and `harness/` is already sound — descent-guarded
(`harness/planState.ts`, `harness/prompts.ts`, `token` (`src/Baton.ts`)),
reached only past an `EEXIST` that proves the file exists (`src/waitLock.ts`,
`src/pidClaim.ts`), guarded by `existsLoudUnder` at every caller
(`liveTipClaim` (`src/git.ts`)), or not a path lookup at all (`harness/ci.ts`,
a spawn). Nothing left to file.

One wording debt, not worth an entry alone: the shared detector's sentence is
read-flavoured, so a write now reports "cannot be written: awake flag —
[flume] awake flag is unreadable: ...". Harmless at one caller; if a second
write-side descent lands, the phrase wants a direction.
