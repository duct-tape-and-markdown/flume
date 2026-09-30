# The fold has one home; two neighbouring cast families are not the same finding

All 31 `(err as Error).message` sites now read `thrownMessage`
(`src/thrown.ts`), the `Error` path byte-identical. Two adjacent families the
same grep shape would catch, on different footing:

**The errno family is bounded by construction, not by luck.** 17 sites read
`(err as NodeJS.ErrnoException).code` or `(err as { code?: unknown }).code`
(`src/git.ts`, `src/pidClaim.ts`, `src/waitLock.ts`, `src/fsProbe.ts`,
`src/Baton.ts`, `src/friction.ts`, `src/spawnShim.ts`, `src/processTree.ts`,
`src/stateRootAccess.ts`, `src/chainLoad.ts`, `harness/toolRun.ts`,
`harness/prompts.ts`). Every one sits over a node builtin — fs, spawn, a
`require` — whose throw is always an `Error`, and each compares the read to a
literal, so `undefined` fails the comparison rather than being printed. No
chain-author code reaches any of them. Re-filing these as the same class would
be a grep verdict over a different property; the property that *would* bite
(`.code` off a thrown `null`) has no site that can receive one.

**`OnDiskIdentity.unresolved` is dead plumbing carrying the cast.**
`src/pathIdentity.ts:82` stores the caught value as `unresolved: err as
Error`, and the field has no reader anywhere in `src/`, `harness/` or
`tests/` — the declaration is the only mention, so the cast had no
fold to be rewritten into. Two findings
stacked at one line — an export with no consumer
(`engineering.md`, *An export earns its consumer*) and the unguarded typing
underneath it — and the first decides the second: if the field goes, the cast
goes with it; if a reader arrives, the reader is where the fold belongs.

Also re-homed: the private `thrownMessage`'s doc said a cast here would carry
a snapshot failure back out into `snapshotReverted`'s revert. That fact is the
site's, not the fold's, so it now sits at that catch
(`src/priorAttempts.ts`) rather than travelling with the function.
