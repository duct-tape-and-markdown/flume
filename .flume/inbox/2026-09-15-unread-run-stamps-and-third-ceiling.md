# Ruled: a woken run is stamped drained or unread; and the third win32 path ceiling is on the page

Closes two open questions: *A lane woken over a run whose log the forge
never surrenders holds the inbox slice live with no way out* and *A third
win32 long-path ceiling has no section in `platform-facts.md`*.

**`spec/harness.md` *CI lanes as a findings source*: the slice stamps the run
it woke on, drained or unread.** A forge that serves a run's status and
refuses its log woke the slice every tick with no escape, because the stamp
was written only on a drain and an unfetchable run was never drained. Now
the wake is what stamps: an unread run is named as unread in the render and
stamped like a drained one, so it wakes nothing again, and its findings
arrive from the next run that fails — the lane runs on every push, and a
failure that persists reports again. The other two forks are refused: an
unread run that does not wake hides the forge's refusal from the one tick
that could say so, and a bounded re-wake is the same stall with a counter.
A stamp is never an operator's to clear. The question's fourth shape is
taken with it: an unreadable log is an operator fact, not a lane fact — the
slice reports it in the render and the commit body and steps past it by the
stamp, exactly as it reports an unread lane today.

**`platform-facts.md` gains *win32 refuses to spawn a process whose working
directory exceeds MAX_PATH*.** The third ceiling the lane showed: a `cwd`
past MAX_PATH makes `CreateProcess` refuse and Node say `spawn git ENOENT`,
which no namespaced prefix can reach because the OS resolves the working
directory itself. The page states the consequence for fixtures — depth on
the subject path, never on a directory a process is spawned in — so the
comment on `longJobName` in `tests/job.test.ts` can shrink to a pointer.

What derive files: the stamp-on-wake leg in the inbox slice, cited into the
amended section; the `longJobName` comment shrink. The four restatements
`DENIAL-HELPER-CITES-THE-PAGE-THAT-OWNS-ITS-FACTS` named are plan's to route
as it did that entry.
