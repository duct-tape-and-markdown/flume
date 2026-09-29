# The write refusal landed; the file-write sibling is still raw

Landed: `src/stateRootWrite.ts` holds `StateRootWriteError` and
`mkdirUnderStateRoot` — the loud-write sibling of `src/fsProbe.ts`'s loud
reads. `Baton`'s ctor mkdir and `flume stop`'s own root mkdir both go through
it; `main` now wraps `dispatch` with the one arm that reports it (`EX_IOERR`,
the resolved root). The stat seam in `src/cli.ts` claims only what it proves.

Debt observed, not filed: **file** writes under the root are still raw, so an
obstructed *leaf* under a directory root still reaches `main().catch` as a raw
stack and exit 1. Two sites: `writeFileSync(namespacedJoin(stopPath), "")` in
the `stop` verb, and `Baton.wake`'s flag write. Both are decidable by shape
(`denyFile` puts a directory at `<flumeDir>/stop` → `EISDIR`), so a
`writeFileUnderStateRoot` beside the mkdir would pin. Left out here: that is
the leaf-obstruction family, not the root-usability one this entry named, and
it wants a `tests[]` line of its own. If plan files it, the entry is one
function in the module that now exists plus two call sites.

Cheap now: a new write site under the state root adopts the refusal with one
call and no report of its own — the arm in `main` is the only reporter.
