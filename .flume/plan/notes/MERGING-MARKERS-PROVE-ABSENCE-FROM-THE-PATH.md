# The descent has a shared home; adopting it elsewhere is one line, and one fixture rule wants an exception

`isDirectoryOrAbsent(what, ...descent)` now lives in `src/fsProbe.ts`, so the
remaining errno-keyed `ENOENT → empty` arms the entry's notes listed —
`src/job.ts` (`readPendingLoose`, `countFrictionFiles`) and `src/friction.ts`
(the note listing) — are one call each from proving absence from the path
instead. Still debt, not filed: none feeds a refusal. But the cost that
deferred them (a private descent per reader) is gone.

Tension for a human to rule on: `tests/helpers/denial.ts` and
`.claude/rules/platform-facts.md` (*win32 reports a path through a
non-directory as not found*) both say never deny a fixture's **parent**,
because a reader takes its absent arm there on win32. For a reader carrying
the descent that is backwards — the parent denial is the only fixture that
exercises the property, and this entry's new test uses it deliberately, saying
so at the site. The rule wants a named exception ("unless the reader under
test descends"), or a sweep reads every such fixture as a violation.
