# Every spawn home ends its child's stdin

Shipped: the async door (`execFileWithShimRetry`) and git's (`spawnGit`) now
hand their promise to `endChildStdin` (`src/spawnShim.ts`); the four sync homes
outside `harness/exec.ts` (the example chain's two,
`scripts/build-changelog.mjs`, `scripts/smoke-install.mjs`) declare
`stdio` with fd 0 off. A fourth scan, `scanSpawnStdin`
(`tests/helpers/spawnCaps.ts`), judges every call reaching a capturing API by
a name its own module binds — the home, since a forwarder's callers cannot
answer for a pipe they never see.

**Platform fact for a human to home in `platform-facts.md`** (build cannot
write that page): `execFile`/`exec` compose their own spawn options and
forward **no `stdio`** — measured on node 22.20 and 24.21, the child always
gets a stdin pipe however the call spells its options. The only seam is the
child riding the promisified call: `p.child.stdin.end()`. So one decision needs
two spellings, and a `stdio: ["ignore", ...]` on an `execFile` call is
silently inert — worth the page: it reads as correct at every site.

**The suite's own async door stays open on purpose.** `exec`
(`tests/helpers/subprocess.ts`) cannot end stdin: `tests/budgetHook.test.ts`
writes the hook's JSON through `run.child.stdin`, which is the documented
reason that wrapper hands the child back. That is why the new scan's domain
stops at `REPO_DOMAIN` and `tests/` is out — not an oversight.

**The scan reads the ender by name** (`SPAWN_STDIN_ENDER`), the trade that
module's header already declares. A decoy binding would pass it and red at
`tests/spawnStdin.test.ts`, which drives both doors over a real child.

**Three suites mocked a childless promisified `execFile`** — a shape the real
call never has, and the door threw on it. One home now:
`tests/helpers/execFileMock.ts`. Plan predicted an edit to `harness/exec.ts`;
none was needed — the async capture lives in `src/spawnShim.ts`, and the sync
door there already closed stdin.
