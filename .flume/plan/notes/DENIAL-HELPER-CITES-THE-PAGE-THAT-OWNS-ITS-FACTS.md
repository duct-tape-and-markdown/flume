# The same two stat facts are restated in four more sites

Shipped as written. Four sites outside this entry's scope carry a fuller
restatement of the ENOTDIR/ENOENT divergence or the `throwIfNoEntry:
false` suppression with **no** cite of the owning section
(`.claude/rules/platform-facts.md`, *win32 reports a path through a
non-directory as not found*):

- `src/priorAttempts.ts` — `isDirectoryOrAbsent`'s doc (~line 105) and
  `readAll`'s (~line 372) each spell both hosts' errnos; the first cites
  `engineering.md` *Loud or nothing* for the posture, never the page for
  the fact.
- `tests/priorAttempts.test.ts` ~line 412 spells the split again; the
  block at ~line 368 cites *chmod denies nothing on win32* — the
  neighbouring-cite shape, but not the section that owns this fact.
- `src/fsProbe.ts` ~line 22 states the suppression the page now owns.

`tests/job.test.ts` ~line 1806, the debt plan already named, is the
cheapest leftover: its one line already carries the page cite beside the
restatement. `src/fsProbe.ts` is engine surface (hover text), so its
shrink is a judgement call rather than a mechanical follow-on.
