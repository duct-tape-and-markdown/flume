# A seventh site reached into src/cli.ts for an exit code

The entry's `files` listed six; `tests/cliHelp.test.ts:21` was a seventh,
importing `EX_IOERR` from `../src/cli.ts` beside `EX_TERMINAL_MISCONFIG` from
`../src/exitCodes.ts` — the same two-homes-in-one-file shape the entry cites
in `tests/cliVerdict.test.ts`. Folded with the rest; nothing else changed in
that file.

Nothing in `src/` imported `EX_DATAERR` or `EX_IOERR` from `src/cli.ts`, so
the move touched no production reader but `src/cli.ts` itself, and neither
constant is on the package's `exports` surface (`src/index.ts` names no exit
code). If a chain is meant to classify a `flume` exit from the package rather
than from the number, that is a surface decision nobody has made — not filed,
just observed.

`src/exitCodes.ts`'s header now says "every verb's, not `flume tick`'s alone";
the two moved constants' own doc comments already named their verbs
(`flume check` for `EX_DATAERR`, "every verb" for `EX_IOERR`), so they moved
verbatim. The two originals still open "`flume tick` exit code for …" and are
accurate as written — `superviseLoop` re-raises them, it does not mint them.
