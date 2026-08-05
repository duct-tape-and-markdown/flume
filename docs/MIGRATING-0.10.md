# Migrating an existing chain to 0.10.0

Audience: any repo with a `.flume/chain.ts` pinned to an earlier
`@dtmd/flume` — `0.2.x`, `0.6.x`, `0.9.0` — that needs to move onto
`0.10.0`. This one guide replaces the per-version chain (`MIGRATING-0.8.md`,
`MIGRATING-0.11.md`); every consumer on record is making a multi-minor jump,
so the steps are organized by *what you have to change*, with a routing table
that tells you which sections apply.

This is an upgrade checklist, not a tutorial. For the full shape of each
surface, see [`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md), [`CLI.md`](CLI.md),
and [`README.md`](../README.md) — this guide links into them rather than
repeating them.

## 0. A note on the version number

**There is no published 0.10-and-0.11 split, and 0.11.0 was never
published.** `v0.11` appears throughout `CHANGELOG.md` and older docs as a
*planning* label — the spec corpus used to carry per-release files
(`spec/RELEASE-v0.11.md`) that have since been flattened into topic files.
The published successor to `0.9.0` is **`0.10.0`**, and it contains
everything those v0.10/v0.11 planning sections describe plus the work that
landed after them.

If you were waiting for a `0.11.0` tag: it isn't coming. Pin `0.10.0`.

Note also that **a caret range on a `0.x` version pins the minor** — `^0.6.0`
resolves within `0.6.x` and will never pick up `0.10.0` on its own. Change
the pin explicitly.

## 1. Which sections apply to you

| You are on | Do these sections |
| --- | --- |
| `0.9.0` | §2 (factory), §6, §7, §8, §9 |
| `0.6.x` | §2, §3, §4, §5, §6, §7, §8, §9 |
| `0.5.x` or earlier | all of the above, plus §10 |

§11 (recommended adoptions) and §12 (symptom → cause) are for everyone.

Work them in order. §3 in particular has a **pre-upgrade** step that must
land before or with the pin bump, never after.

## 2. Move your chain to the factory shape (required, everyone)

`.flume/chain.ts` default-exports a **factory** the engine calls with its own
API, instead of a `Chain` object. Take every engine value from the parameter;
demote the remaining engine import to `import type`.

Before:

```ts
import type { Chain, Phase } from "@dtmd/flume";
import { tscGate, pendingGate } from "@dtmd/flume";

const build: Phase = { /* ... */ gates: [tscGate] };
const chain: Chain = { phases: [build], humanOnly: [] };
export default chain;
```

After:

```ts
import type { Chain, ChainFactory, Phase } from "@dtmd/flume";

const factory: ChainFactory = (flume) => {
  const { tscGate, pendingGate } = flume;

  const build: Phase = { /* ... */ gates: [tscGate] };
  const chain: Chain = { phases: [build], humanOnly: [] };
  return { chain };
};

export default factory;
```

Mechanical checklist:

1. Delete every **value** import from `@dtmd/flume`; keep `import type`.
2. Wrap everything that used those values in
   `const factory: ChainFactory = (flume) => { ... }` and destructure what
   you need from `flume` at the top. Declarations that need no engine value
   (a `zod` entry extension, plain constants) can stay at module scope.
3. Return `{ chain }` and `export default factory`.
4. If you exported `agent` or `forkResolver` as **named exports**, move them
   onto the return: `return { chain, agent, forkResolver }`. A named export
   can no longer reach the engine.
5. `git.showNameOnly` and friends arrive as `flume.git.showNameOnly`;
   `readTickVerdicts` and the error classes you branch on with `instanceof`
   (`CjsContextLoadError`, `PendingParseFailure`, `InlineExecRenderError`,
   `TipClaimHeldError`) arrive the same way.

**Why it is required rather than opt-in.** A chain that imports engine values
resolves them by walk-up from its own directory. Whenever the running engine
is not the copy that walk-up finds, the process holds two engines: one
driving the dispatcher, one building your phases — `instanceof` and
module-level state split across them **at equal versions**, with nothing
reporting it and commits as the output. A factory has nothing to resolve, so
the condition stops being reachable. That is also why a non-function default
export is refused outright instead of falling back to the old shape: a
fallback would readmit exactly what this removes.

**What this fixes for you.** A globally-installed engine used to be
structurally unreachable from a chain's import — the run died with a raw
`ERR_MODULE_NOT_FOUND` naming the very package that was executing. That
failure is gone; the chain binds to whichever engine is running.

## 3. Declare `Chain.entryExtension` (pre-0.8 only, pre-upgrade)

The engine core (`tag`, `files`, `gate`, `dependsOnForks`) is **strict**: a
pending-entry field that is neither core nor declared in the chain's
`entryExtension` fails validation loudly. If your `pending.json` carries
`summary`, `per`, `tests`, `acceptance`, `notes`, or anything else
project-specific, your first parse after the pin bump hard-fails unless the
extension is already declared.

Do these in order, and land the last one **before or in the same commit as**
the pin bump — never after:

1. **Inventory every non-core field** your `pending.json` entries carry. Read
   a live entry or two, or grep the chain's plan prompt for the schema it
   currently renders.
2. **Author `Chain.entryExtension`** — one declaration per field, each
   carrying a validator and a prompt hint (see
   [CHAIN-AUTHORING.md §10](CHAIN-AUTHORING.md#10-declaring-an-entry-extension-entryextension)).
   This is the same declaration your hand-rolled parse gate and your plan
   prompt's `PENDING_SCHEMA` arg both need to reference.
3. **Strip or declare retired fields.** `schemaDelta` is deleted from the
   engine core outright — no consumer ever read it. Either drop it from
   `pending.json` and your plan prompt, or declare it in your extension if
   your workflow actually uses it.
4. **Land the extension before or with the pin bump.** Bumping the pin first
   — even for one tick — means your next plan or build tick fails at the
   parse gate with no recovery path but a manual fix.

`EntryExtensionField.schema` accepts any
[Standard Schema](https://standardschema.dev) validator, not only `zod`.
Existing zod schemas already satisfy it (zod ≥ 3.24), so there is **nothing
to change** in an extension that already works — the engine now *adapts* your
validator rather than merging its object into its own schema graph, which
closes a class of failure where a chain's zod copy and the engine's skewed
and every `safeParse` threw
`TypeError: Cannot read properties of undefined (reading 'traits')` from
inside zod's internals.

## 4. Mechanical renames (pre-0.8)

- **`requiresDockerHost` → `{ kind: "requiresCapability", capability: string }`.**
  The gate kind is deleted, not deprecated. Any entry gated on the Docker
  host becomes
  `gate: { kind: "requiresCapability", capability: "docker-host" }`, and the
  chain declaration gains `capabilities: string[]` naming the environment
  facts it has verified (`chain.ts` can probe the environment at load time —
  see
  [CHAIN-AUTHORING.md §7](CHAIN-AUTHORING.md#7-capability-gating-requirescapability)).
  An entry gated on a capability the chain doesn't assert is skipped, and
  `flume status` names the missing capability — never a silent skip.
- **`PendingEntry`/`PendingList` become type-only imports.** `PendingList`
  used to be a runtime zod schema (`z.array(PendingEntry)`) some hand-rolled
  gates imported as a value. It is now a plain type (`PendingEntry[]`);
  there is no bare validator to import. Replace a validator usage with
  `composePendingList(entryExtension)` (or the `pendingGate` builtin, §11),
  and change type-only usage to
  `import type { PendingEntry, PendingList } from "@dtmd/flume"`.
- **Extension-field reads narrow through the declared schema.** Anywhere your
  chain code reads a non-core field off `ctx.assignedEntry` (e.g.
  `entry.per.path`), narrow it through the schema you declared instead of
  trusting the ambient type — `ctx.assignedEntry`'s extension fields are
  typed `unknown`.
- **`DispatcherOptions.trunkBranch` is removed** — it was stored and never
  read.

## 5. The job apparatus is a state root (pre-0.11-planning-line)

`flume job new` no longer creates or asserts a `job/<name>` branch;
`flume job run`/`flume job rm` no longer check out or assert one; and
`flume job extract` — along with its only consumer, `Chain.harvest` — is
removed outright. A job is now exactly `.flume/jobs/<name>/`, on whatever
branch the operator happens to be on. See
[`spec/jobs.md` § A job is a state root](../spec/jobs.md#a-job-is-a-state-root).

`tick`/`loop` no longer refuse under `--job` when HEAD isn't `job/<name>` —
that preflight is gone with the grammar.

### If you have a live `job/<name>` branch

It still exists; 0.10 doesn't touch it, it just stops managing it. Integrate
or abandon it with ordinary git, then delete it:

- **Merge.** `git merge job/<name>` (or a PR from it) keeps the full
  commit-by-commit record, harness ticks included.
- **Squash.** `git merge --squash job/<name>` keeps the result clean — one
  commit, no tick noise — at the cost of the per-tick history.
- **Abandon.** The job's `.flume/jobs/<name>/` state root rides on the branch,
  so discarding the branch discards the job's record with it. Confirm that's
  intended.

```sh
git branch -D job/<name>               # local
git push origin --delete job/<name>    # if pushed
```

`flume job rm <name>` (unchanged) removes the *state root* — it was never
responsible for the branch — so run it separately, on whatever branch you
want that cleanup commit to land on.

### Replacing `extract`

There is no engine replacement, by design: the clean-history ending is a
branch strategy, not engine machinery. Where you still want a deliverable
branch with no harness commits on it:

1. Run the job on a side branch (any branch you choose).
2. Fork the deliverable off the target base:
   `git checkout -b docs-refresh-clean main`
3. Squash-merge the side branch onto the fork
   (`git merge --squash job/docs-refresh && git commit`), or cherry-pick the
   commits that belong. Which commits are "the deliverable" versus "harness
   ticks" is the operator's judgment — exactly the domain knowledge
   `extract`'s path-prefix filter used to guess at.
4. Read anything the state root collected for you — a `Chain.friction` dir's
   notes, an `open-questions.md` — off the working tree or with
   `git show job/<name>:<path>`.
5. `git push origin docs-refresh-clean` and `flume job rm docs-refresh`.

If your chain still declares `Chain.harvest`, delete the field. Nothing loads
or validates it, so leaving it is inert rather than broken — but it will
mislead the next reader. `Chain.seedDir` and `Chain.friction` are unaffected.

## 6. Entry-scoped writes are now opt-in (0.9.0 → 0.10.0)

**This is the change most likely to alter behavior silently.**

Before 0.10, every fanout tick with an assigned entry automatically narrowed
its write fence to `declaredPaths(entry) ∪ entryChannelPaths`. That narrowing
is now an explicit opt-in:

```ts
const build: Phase = {
  // ...
  scopeWritesToEntry: true,   // restores pre-0.10 behavior
};
```

Undeclared (the default, `false`), a fanout tick's rendered fence and its
`writablePathsGate` see the phase's `writablePaths` ceiling only —
byte-identical to a singleton tick's.

**Decide deliberately, don't just restore the old value.** The reason the
default flipped: where a phase may write is a standing phase/phase
relationship, but the old behavior let a *producer* entry govern the
*consumer* phase's implementation surface. It also forced `files` to serve
two opposed masters — a narrow, honest declaration for the fanout partition's
disjointness key, and a wide, defensive one to avoid the commit being
reverted. No producer can satisfy both, and the measured cost was mean
first-batch wave width falling from **3.17 to 1.99** at `maxParallel: 4`,
once one shared path entered substantially every entry.

If your fanout waves have been narrower than you expected, leave it
undeclared and let `writablePaths` do the containing.

## 7. Ship classification is the chain's call (0.9.0 → 0.10.0)

An entry ships when **its commit landed and its gates passed**. The engine no
longer diffs the cherry-picked commit against `declaredPaths(entry)`, so
`entry.files` is a partition prediction and a fence input only — never
load-bearing for whether an entry drains from the queue.

If your chain relied on the old behavior to hold an entry pending (an agent
that wrote only to a channel path and expected to stay queued), declare the
predicate:

```ts
const PARK_FILE = ".flume/plan/open-questions.md";

const build: Phase = {
  // ...
  shipped: ({ touchedPaths }) =>
    !(touchedPaths.length > 0 && touchedPaths.every((p) => p === PARK_FILE)),
};
```

`ShipContext` carries the entry, the merged sha, the commit's touched paths,
the gate results, the still-present worktree path, and the repo root.
Returning `false` keeps the entry pending; the `MergeOutcome` member is
`not-shipped` (renamed from `channel-only`).

Undeclared, everything that lands green ships. There is no engine-side park
heuristic — the engine used to regex an agent's final message for the word
"parked", which was the engine holding an opinion it was never told
(`.claude/rules/engine-boundary.md`, "Told, not inferred").

## 8. `flume render` is removed

There is no replacement subcommand. It previewed with the wrong fence, the
wrong prior-attempt state, and its own re-derivation of pickability that
disagreed with the dispatcher's — three ways to show an operator a prompt the
next tick would not send.

If a script, CI step, or install smoke test invokes `flume render`, repoint it.
`flume status` is the usual substitute for "is this thing wired up." The
`renderPrompt` export (`src/Prompt.ts`) is untouched — it is the tick's own
render path — so an embedder calling it directly is unaffected.

## 9. New refusals to expect

Each of these used to be a silent degrade. If your CI or wrapper script hits
one, the refusal is the fix reporting itself, not a regression.

| Refusal | Exit | Was |
| --- | --- | --- |
| `FLUME_DIR` carries a `FLUME_DIR_RESOLVED_FOR` stamp for a different repo | 2 | A nested `flume` in another repo wrote to the outer repo's control plane |
| `wake`/`sleep` naming a phase the chain doesn't declare | 2 | The marker landed on disk for a phase that doesn't exist |
| `--job`/`FLUME_JOB` naming a state root that doesn't exist | 2 | Silently materialized `.flume/jobs/<name>` — a typo became a bare job dir |
| An unparseable `pending.json` | 69 | Read as an empty queue: hibernate clean, or commit `[]` over the whole file |
| An inline-exec (`` !`cmd` ``) span that fails to resolve | — | Substituted `<exec-failed …>` into the prompt and sent it anyway |
| `flume loop --max` with a missing, non-numeric, or negative value | 2 | Parsed to `NaN`, ran zero ticks, exited 0 — indistinguishable from a clean hibernation |
| `flume job new` in a CJS-context host | 2 | Exit 1, buried behind `[flume] job new failed:` |

`flume tick` and `flume loop` also stop reporting every `git symbolic-ref`
failure as a detached HEAD: a cwd outside any repository, and a git binary
that never ran, each get their own message now.

## 10. Deltas a pre-0.5 chain will feel on the same jump

- **`Baton` constructs from the flume state dir, not the repo root.** If you
  construct one directly, pass `flumeDir`.
- **Invocation is exec-local, full stop.** No re-exec, no version check, no
  refusal. Declare `@dtmd/flume` as a dev dependency and invoke it through
  the package manager (`pnpm exec flume`, an npm script, `npx flume`) so the
  binary that runs is always your own pinned copy. A stray global install is
  unsupported *and undetected* — it will fail however it fails.
- **The exit-code contract.** `flume tick` returns `0` on a committed or
  cleanly-hibernating tick, `2` on a usage error, `69` when the chain never
  resolved, `78` on a terminal misconfiguration. `flume loop`/`job run`
  propagate a child's `69`/`78` unchanged, return `1` unconditionally if the
  consecutive-failure backstop aborted the run, and otherwise return `1` only
  if some tick errored *and* nothing shipped. Re-check any CI branch that
  does a bare zero/nonzero test.
- **Bay-discovery walk-up.** The CLI walks up from `cwd` for the nearest
  `.flume`, mirroring how git finds `.git/`. A `cd` into a subdirectory now
  resolves correctly — but a repo nested inside another repo's tree resolves
  to the *nearer* one, which may not be the one you meant. §9's cross-repo
  `FLUME_DIR` refusal exists because of exactly this shape.

## 11. Recommended adoptions

None are required; each removes maintenance surface the engine now owns
generically.

- **`pendingGate`** replaces a hand-rolled pending-parse gate. It validates
  against your composed core+extension schema *and* pre-checks every entry's
  declared `files` against a target phase's fence, failing at plan time with
  the offending paths named — instead of a plan commit shipping an entry
  guaranteed to revert on build's next tick. It takes an optional `hint` for
  chain-authored operator guidance.
- **`setupWorktree`** replaces a per-repo `npm ci`/`pnpm install` hardcode in
  a fanout worktree-setup hook. It reads the target's lockfile
  (`pnpm-lock.yaml` wins if both are present) and runs the install it
  implies, refusing rather than guessing if neither is there.
- **`tscGate`/`vitestGate`/`eslintGate` overrides.** Each is still usable
  bare, but is now callable with `{ cmd, args }` to run the same check
  through a different package manager. **If you are on npm, you need both**:
  `{ cmd: "npm" }` alone leaves pnpm-shaped args, and npm has no bare
  `npm tsc` verb — the gate reports "TypeScript errors" for a check that
  never ran. Use `{ cmd: "npm", args: ["exec", "--", "tsc", "--noEmit"] }`.
- **`Chain.supervisorPolicy`** opens the `flume loop` supervisor's
  `quarantineScope`, `abortThreshold`, and — new in 0.10 — `maxParallel`,
  the fanout batch width that used to be embedder-only.
- **`DispatcherOptions.commitMessage`, `JobNewOptions`/`JobRmOptions`
  `commitMessage`.** The engine's ledger, job-seed, and job-cleanup commits
  used to hardcode `chore(flume): …`. Supply your own wording if that prefix
  isn't yours.
- **`Phase.shouldRun`.** An optional predicate consulted before rendering the
  prompt or invoking the agent. Return `false` to decline a tick you already
  know is a no-op, without spending an agent invocation to reach the same
  conclusion. Reported as its own `declined` fact, distinct from a voluntary
  bail and from hibernation.
- **Tip claim and tip verify.** `flume loop` now claims the tip its HEAD
  resolves to and releases it at exit — one flume writer per tip, visible
  across every worktree of one repository. Independently, a tick commits only
  onto the tip it started on; a moved ref refuses the commit rather than
  landing it. Nothing to declare; both are on. `tick` and `loop` refuse a
  detached HEAD (exit 1) because the claim keys on a named ref.

## 12. Symptom → cause table

| Symptom | Cause |
| --- | --- |
| `chain.ts must default-export a chain factory` | Your chain still default-exports a `Chain` object — §2. |
| `ERR_MODULE_NOT_FOUND: Cannot find package '@dtmd/flume'` from a globally-invoked `flume` | Pre-factory shape: the chain resolved the engine by walk-up, which cannot reach a global install. Fixed by §2. |
| Unexplained `instanceof` failures, or a gate/agent behaving as if its module state were empty | Two engine copies in one process. Fixed by §2. |
| Parse gate fails with `Unrecognized key: "<field>"` | A non-core pending-entry field isn't declared in `Chain.entryExtension` — §3. |
| `TypeError: Cannot read properties of undefined (reading 'traits')` from inside zod | Your zod copy and the engine's skewed, pre-Standard-Schema. Closed by construction in 0.10 — no action, just an explanation if you hit it before upgrading. |
| A tag that validated before is now rejected | Either it violates the engine's mechanical floor (whitespace, a path separator, an out-of-charset character), or your own `entryExtension` tag refinement is stricter than what shipped. Test against the bare core pattern to tell which. |
| An entry gated on Docker never gets picked | `requiresDockerHost` is gone — §4. |
| A hand-rolled gate fails to build against `PendingList` | It's a type now, not a runtime schema — §4. |
| `flume job extract` is not a recognized verb | Removed, no engine replacement — §5. |
| `Chain.harvest` is accepted but does nothing | It has no consumer left — §5. |
| A build tick writes outside the entry's declared files and the commit is *not* reverted | Expected — entry-scoped narrowing is opt-in now. Declare `scopeWritesToEntry: true` if you want it back — §6. |
| Fanout waves are wider than they used to be | Same cause, and usually the point — §6. |
| An entry that used to stay pending now drains from the queue | Ship classification no longer diffs declared files. Declare `Phase.shipped` — §7. |
| A CI step fails on `flume render` | Removed — §8. |
| `CrossRepoFlumeDirError`, exit 2 | A nested invocation inherited an absolute `FLUME_DIR` stamped for another repo — §9. |
| `flume loop` exits 2 on a `--max` value that used to be accepted | It parsed to `NaN` and ran zero ticks. The refusal is the fix — §9. |
| `flume loop` now exits non-zero on a run that used to exit 0 | A child exited non-zero without reaching the verdict write; that no longer goes uncounted. The run was already failing. |

## Non-goals

This guide does not perform any consumer's migration — your `entryExtension`
declaration, capability set, `scopeWritesToEntry` decision, and `shipped`
predicate are your repo's work, informed by your own `pending.json` and your
own chain. It does not perform branch integration: whether to merge, squash,
or abandon a `job/<name>` branch is a judgment call about that branch's
content. And it does not duplicate
[`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md)'s reference material; where a step
needs the full shape of a surface, it links there.
