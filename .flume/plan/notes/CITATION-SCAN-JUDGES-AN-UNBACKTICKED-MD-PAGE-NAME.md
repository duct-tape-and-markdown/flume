# The unfenced arm found seven wrapped page cites, and `harness/` carries none

Widening the scan surfaced seven page citations already broken across a
comment line — six in `Dispatcher.ts` (312, 540, 1167, 3076, 3655, 4214 on
the base tree) and one in `worktrees.ts` (433), each a line ending `(spec/`
or `.claude/rules/`. All rewrapped here.

Unfenced there is no `broken` report to give them, and none is needed: the
tail a wrap leaves (`loop.md` alone) is a name the working tree cannot
answer, so it dangles. But a wrap whose tail *did* resolve would pass
silently — not reachable today, since no root-level page shares a `spec/`
basename. Worth a lens if one ever lands.

Second: every unfenced page name in the judged trees sits in `src/`.
`harness/` has one `PROTOCOL.md`, inside `cli.ts`'s help string — not a
comment, so out of scope. The new repo pin is `src/`-only in practice; its
title says so.
