# State

Phase: **v0.1 public-release prep.** Mode this tick: **audit** — 3 build commits + 1 chore drained the prior queue. Audited each:

- `DIST-DTS-EXTENSIONS` (1f63181): 7 src/ files flipped to `.js` specifiers; remaining src/ files (`Agent`, `Baton`, `Gate`, `git`, `PendingSchema`) have no local imports — nothing missed. Rebuilt `dist/` and grep'd `dist/*.d.ts`: clean of `.ts` extensions. (The on-disk `dist/` committed by the chore step is stale from a pre-fix build, but `dist/` is gitignored; the npm tarball is built at publish time per §4.)
- `BIN-FLUME-DIST` (58a0137): shim is `exec node "$DIR/../dist/cli.js"`. Smoke: `./bin/flume status` → `awake: plan`. Clean. The "installed-as-dependency" half of §4 acceptance is downstream of `PACKAGE-METADATA` setting up the `bin` field — not a gate-bypass here.
- `CI-WORKFLOW` (d111e68): matches §8 — Node 22, pnpm store cache via `setup-node`'s `cache: pnpm`, runs `install --frozen-lockfile / typecheck / test / build` on push to main and PRs. §8 acceptance ("green on main for at least one PR before tagging") is downstream of PR work, not enforceable from a plan tick.

Inbox empty. No spec changes. **Promote**: `DIST-DTS-EXTENSIONS` shipped → `PACKAGE-METADATA` flips from `blockedBy: DIST-DTS-EXTENSIONS` to `open`; stale "attw blocks me" line trimmed from notes.

Queue: `PACKAGE-METADATA` (open). 1 entry.

In flight: nothing autonomous. Build picks `PACKAGE-METADATA` on next tick. After it ships, pending is empty and v0.1 is at the tagging gate — remaining acceptance is out-of-band: choose the scope name, run a CI-green PR (§8), then tag.

Open questions: 0.

Trunk: `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 68 tests); `pnpm build` succeeds and `dist/*.d.ts` emits clean specifiers.

Plan continues: no
