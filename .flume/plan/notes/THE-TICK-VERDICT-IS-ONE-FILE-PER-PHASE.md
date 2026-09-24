# Two ignore copies outside this tick's fence still spell the old filename

The verdict is now `<flumeDir>/tick-verdict/<phase>.json`, and `RUNTIME_IGNORES`
names `tick-verdict/`. Two on-disk copies of the old line are outside build's
writable paths and unchanged:

- `.flume/.gitignore` (line 7, `tick-verdict.json`). The engine's own seed at
  `loop` start appends `tick-verdict/`, so the directory is covered from the
  next run — but the stale line stays until someone edits that file. Inert,
  not wrong.
- `spec/jobs.md`'s runtime-ignore listing, which the entry's own notes already
  routed to the open question on spec sentences trailing shipped behavior. It
  now trails on the *shape* too, not just the name.

Two things I decided rather than parked, both stated at the site:

1. The phase keys the filename raw, no slug — `Baton` already writes
   `awake/<name>` that way (`src/Baton.ts`), and two spellings of a phase's
   own filename is how a flag and a verdict come to disagree. Nothing
   validates a declared phase name as a path component; that exposure is
   `Baton`'s already and this adds no new one.
2. `clearTickVerdict(flumeDir, phase?)` — a `--phase` tick clears its own
   file, a bare tick clears the directory. Bare is safe because it holds the
   tip claim itself, so it has no sibling child.

`docs/MIGRATING-0.19.md` § 7 carries the consumer-side cutover (one ignore
line, one stale file to `rm`). Nothing in a chain reads the path.

The gate this entry named is now open: `maxTicks` above 1 no longer loses a
child's facts.
