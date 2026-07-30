# Migrating an existing chain to 0.8.0

Audience: a bay running a pre-0.8 chain (`connect`, `temper`, the DAL-class
jobs — anything derived before this line shipped) that needs to move onto
`@dtmd/flume@0.8.0`. No 0.7.0 was ever published, so a 0.6.x bay crosses both
lines in one jump: it picks up v0.8 §2's strict entry schema *and* every v0.7
operational delta (§4 below) at once.

This is an upgrade checklist, not a tutorial. For the full shape of each new
surface, see [`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md) — this guide links
into it rather than repeating it.

## 1. Pre-upgrade — do this before bumping the pin

The engine core (`tag`, `files`, `gate`, `dependsOnForks`) is now **strict**:
a pending-entry field that is neither core nor declared in the chain's
`entryExtension` fails validation loudly (`PendingSchema.ts`'s
`composePendingList`). If your `pending.json` carries `summary`, `per`,
`tests`, `acceptance`, `notes`, or anything else project-specific, your first
parse after the pin bump hard-fails unless the extension is already declared.
Do these in order, and land the last one **before or in the same commit as**
the pin bump — never after:

1. **Inventory every non-core field** your `pending.json` entries currently
   carry. Read a live entry or two, or grep the chain's plan prompt for the
   schema it currently renders.
2. **Author `Chain.entryExtension`** — one declaration per field, each
   carrying both a zod schema and a prompt hint (see
   [CHAIN-AUTHORING.md §10](CHAIN-AUTHORING.md#10-declaring-an-entry-extension-entryextension)
   for the full pattern). This is the same declaration your hand-rolled parse
   gate and your plan prompt's `PENDING_SCHEMA` arg both need to reference.
3. **Strip or declare retired fields.** `schemaDelta` is deleted from the
   engine core outright (v0.8 §2) — no consumer ever read it. Either drop it
   from `pending.json`/your plan prompt, or declare it in your extension if
   your workflow actually uses it.
4. **Land the extension declaration before or with the pin bump.** The
   extension is what makes your existing `pending.json` parseable against
   the new strict core. Bumping the pin first — even for one tick — means
   your next plan or build tick fails at the parse gate with no recovery
   path but a manual fix.

## 2. Mechanical renames

- **`requiresDockerHost` → `{ kind: "requiresCapability", capability: string }`.**
  The gate kind is deleted, not deprecated (pre-1.0 clean-slate,
  `.claude/rules/spec-plan-build.md`). Any entry gated on the Docker host
  becomes `gate: { kind: "requiresCapability", capability: "docker-host" }`,
  and the chain declaration gains `capabilities: string[]` naming the
  environment facts it has verified (`chain.ts` can probe the environment at
  load time — see
  [CHAIN-AUTHORING.md §7](CHAIN-AUTHORING.md#7-capability-gating-requirescapability)).
  An entry gated on a capability the chain doesn't assert is skipped, and
  `flume status`/the plan prompt names the missing capability — never a
  silent skip.
- **`PendingEntry`/`PendingList` become type-only imports.** Pre-0.8,
  `PendingList` was a runtime zod schema (`z.array(PendingEntry)`) some
  hand-rolled gates imported as a value to validate against. Post-split it's
  a plain type (`PendingEntry[]`) — there is no bare `PendingList` validator
  to import anymore. Replace `import { PendingList } from "@dtmd/flume"`
  used as a validator with `composePendingList(entryExtension)` (or reach
  for the `pendingGate` builtin in §3), and change any type-only usage to
  `import type { PendingEntry, PendingList } from "@dtmd/flume"`.
- **Extension-field reads narrow through the declared schema.** Anywhere
  your chain code reads a non-core field off `ctx.assignedEntry` (e.g.
  `entry.per.path`), narrow it through the same schema you declared instead
  of trusting the ambient type:
  ```ts
  const per = entryExtension.per.schema.parse(ctx.assignedEntry.per);
  ```
  `ctx.assignedEntry`'s extension fields are typed `unknown` — the compiler
  can no longer assume their shape, only your extension's schema can.

## 3. Recommended adoptions

Each replaces a hand-rolled pattern most pre-0.8 chains carry; none are
required, but each removes maintenance surface `src/` now owns generically.

- **The `pendingGate` builtin** (`@dtmd/flume`) replaces a hand-rolled
  pending-parse gate. It validates the pending list against your composed
  core+extension schema *and* pre-checks every entry's declared `files`
  against a target phase's fence, failing at plan time with the offending
  paths named — instead of a plan commit shipping an entry that is
  guaranteed to revert build's next tick. Attach it to your plan phase's
  `gates`, passing your `entryExtension` and the build phase's fence as
  `targetFence`.
- **The `setupWorktree` helper** (`@dtmd/flume`) replaces a per-repo
  `npm ci`/`pnpm install` hardcode in a fanout phase's worktree-setup hook.
  It inspects the target directory's lockfile (`pnpm-lock.yaml` wins over
  `package-lock.json` if both are present) and runs the install it implies,
  refusing rather than guessing if neither is there. `connect`'s chain is
  the named consumer this was lifted from (v0.7 §11) — if your chain
  hand-rolls this today, this is a straight swap.
- **`Chain.supervisorPolicy`** opens the `flume loop` supervisor's
  quarantine scope and consecutive-failure abort threshold, previously
  fixed engine behavior (v0.7 §16). Declare nothing and you get the same
  defaults (`quarantineScope: "run"`, `abortThreshold: 3`); override either
  if your bay's failure profile warrants it.
- **Wake-on-bail via `TickResult.noCommit`.** A build tick that bails
  without shipping (nothing pickable, a voluntary bail) now surfaces that
  as `TickResult.noCommit` in the handoff result. If your `handoff` only
  ever inspected `shippedTags`/`gateResults` to decide whether to wake plan,
  it was likely blind to this case — read `result.noCommit` to distinguish
  a genuine no-op from a bail plan should react to.

## 4. v0.7 operational deltas the bay will feel on the same jump

Because no 0.7.0 shipped standalone, a 0.6.x bay hits all of these for the
first time alongside the v0.8 schema split:

- **The engine↔pin handshake.** Every `flume` invocation now checks, ahead
  of any subcommand: does a local install resolve at
  `<flumeDir>/node_modules/@dtmd/flume`? If so, that install is re-exec'd
  and is the authority — no version comparison. If not, and the bay's
  `package.json` pins `@dtmd/flume`, the CLI **refuses** (exit 2), naming
  the pin and telling you to provision it. Provisioning means running
  `flume job new <name>` (which links the local install into the job-scoped
  state root), or dropping the pin from `package.json` to run unpinned as
  the escape hatch. A pinned bay with no provisioned install is a hard stop,
  not a silent fallback to whatever `flume` is on `PATH`.
- **The exit-code contract.** `flume tick` returns `0` on a committed or
  cleanly-hibernating tick, `2` on a usage error (including the handshake
  refusal above), `69` when the chain never resolved at all, `78` on a
  terminal misconfiguration (a chain that loaded but declares an
  inconsistent world). `flume loop`/`job run` propagate a child's `69`/`78`
  unchanged, return `1` unconditionally if the consecutive-failure backstop
  aborted the run, and otherwise return `1` only if some tick errored *and*
  nothing shipped — a partial-success run (some ticks errored, but at least
  one shipped) still exits `0`. If your CI or supervisor wrapper branches on
  exit code, re-check it against this table rather than a bare
  zero/nonzero check.
- **Bay-discovery walk-up.** The CLI no longer requires running from the
  repo root: it walks up from `cwd` looking for the nearest `.flume`,
  mirroring how git finds `.git/`. If your CI invocation `cd`s into a
  subdirectory before running `flume`, this now resolves correctly instead
  of failing to find the bay — but a bay nested inside another bay's tree
  will resolve to the nearer one, which may not be the one you meant.

## 5. Symptom → cause table

| Symptom | Cause |
| --- | --- |
| Plan or build tick fails at the parse gate with `Unrecognized key: "<field>"` | A pending-entry field your chain uses (`summary`, `per`, `tests`, …) isn't declared in `Chain.entryExtension` yet — see §1. |
| CLI refuses at startup naming a pinned `@dtmd/flume` version | The bay's `package.json` pins the package but no local install is provisioned at `<flumeDir>/node_modules/@dtmd/flume` — run `flume job new <name>`, or drop the pin to run unpinned (§4). |
| A tag that validated pre-upgrade is now rejected | Either it violates the engine's mechanical floor (whitespace, a path separator, an out-of-charset character), or your chain declared a `tag` refinement in `entryExtension` ([CHAIN-AUTHORING.md §11](CHAIN-AUTHORING.md#11-refining-the-tag-grammar)) that's stricter than what shipped before — check which by testing the tag against the bare core pattern first. |
| An entry gated on Docker (or another environment fact) never gets picked, and `flume status` says why | `requiresDockerHost` is gone; the entry needs `gate: { kind: "requiresCapability", capability: "..." }` and the chain needs a matching `Chain.capabilities` entry (§2). |
| A hand-rolled pending-parse gate compiles against the old `PendingList` import and now fails to build | `PendingList` is a type, not a runtime schema, post-split — swap the validator for `composePendingList(entryExtension)` or the `pendingGate` builtin (§2, §3). |

## Non-goals

This guide does not perform any downstream bay's migration — each bay's
`entryExtension` declaration, tag refinement, and capability set are its own
repo's work, informed by its own `pending.json`. It also does not duplicate
[`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md)'s reference material; where a
step needs the full shape of a new surface, it links there instead.
