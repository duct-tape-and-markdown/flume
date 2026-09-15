# Landed: the POSIX lane is declared, so its reds reach the inbox slice

Closes the open question *The POSIX lane is undeclared, so its reds reach no
tick*. `.flume/declaration.ts` now declares two lanes on `ci.yml`: `windows`
(job `windows`) and `posix` (job `ci`). The POSIX job carries the integration
lane and the publish-acceptance steps, which no tick runs and, until now,
nothing read; from the next drain its failing titles are findings keyed
under `posix`, stamped per run like the Windows lane's.

The edit is this repo's own declaration, outside every phase fence, which is
why it lands from here. Nothing for derive.

The question closes.
