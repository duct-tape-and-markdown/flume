# Migrating an existing chain to 0.11.0

Audience: a bay that used `flume job` before this line — it may be holding a
live `job/<name>` branch (created by a pre-0.11 `flume job new`), may have
called `flume job extract`, or may declare `Chain.harvest` — and needs to
move onto `@dtmd/flume@0.11.0`.

This is an upgrade checklist, not a tutorial. For the full shape of the
current job surface, see [`README.md`](../README.md#jobs) and
[`docs/CLI.md`](CLI.md) — this guide links into them rather than repeating
them.

## 1. What changed

The job apparatus's branch grammar is retired: `flume job new` no longer
creates or asserts a `job/<name>` branch, `flume job run`/`flume job rm` no
longer check out or assert one, and `flume job extract` — along with its
consumer, `Chain.harvest` — is removed outright. A job is now a state root,
`.flume/jobs/<name>/`, on whatever branch the operator happens to be on;
nothing in the engine has an opinion about branch topology. See
[`spec/jobs.md` § A job is a state root](../spec/jobs.md#a-job-is-a-state-root)
for the ruling this subtracts from (git remains the record; git
*coordination* — branch grammar, mount choreography, a cherry-pick ending —
was the engine absorbing convention, and it goes).

Separately, **every chain must move to the factory shape**
([`spec/chain.md` § The chain is a plugin, not a
consumer](../spec/chain.md#the-chain-is-a-plugin-not-a-consumer)). This one
is not subtractive and not optional — it is the only change in this release
that every bay must make, whether or not it ever touched `flume job`. See §2
below.

The job removals themselves change no pending-entry schema and add no
validation gate.

## 2. Move your chain to the factory shape (required)

`.flume/chain.ts` now default-exports a **factory** the engine calls with
its own API, instead of a `Chain` object. Take every engine value from the
parameter; demote the remaining engine import to `import type`.

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
4. If you exported `agent` or `forkResolver` as **named exports**, move
   them onto the return: `return { chain, agent, forkResolver }`. A named
   export can no longer reach the engine.
5. `git.showNameOnly` and friends arrive as `flume.git.showNameOnly`.

**Why it is required rather than opt-in.** A chain that imports engine
values resolves them by walk-up from its own directory. Whenever the
running engine is not the copy that walk-up finds, the process holds two
engines: one driving the dispatcher, one building your phases —
`instanceof` and module-level state split across them **at equal
versions**, with nothing reporting it and commits as the output. A factory
has nothing to resolve, so the condition stops being reachable. That is
also why a non-function default export is refused outright instead of
falling back to the old shape: a fallback would readmit exactly what this
removes.

**What this fixes for you.** A globally-installed engine used to be
structurally unreachable from a chain's import — the run died with a raw
`ERR_MODULE_NOT_FOUND` naming the very package that was executing. That
failure is gone; the chain binds to whichever engine is running.

## 3. If you have a live `job/<name>` branch

A branch a pre-0.11 `flume job new`/`flume job run` created or checked out
still exists — 0.11 doesn't touch it, it just stops managing it. Integrate
or abandon it with ordinary git, then delete it:

- **Integrate — merge.** `git merge job/<name>` (or open a PR from it) keeps
  the full commit-by-commit record, harness ticks included. Right when the
  bay values seeing exactly how the job's state root evolved alongside the
  work it caused.
- **Integrate — squash.** `git merge --squash job/<name>` (or your git
  host's squash-merge) keeps the result clean — one commit, no harness-tick
  noise — at the cost of the per-tick history. Right when the destination
  branch's history is meant to read as human-authored commits, not a tick
  log.
- **Abandon.** Nothing to integrate — the job's `.flume/jobs/<name>/` state
  root rides on the branch either way, so discarding the branch discards
  the job's record along with it. Confirm that's intended before deleting.

Either way, finish with:

```sh
git branch -D job/<name>     # local
git push origin --delete job/<name>   # if pushed
```

`flume job rm <name>` (unchanged) removes the *state root* — it was never
responsible for the branch, before or after this line — so run it
separately if the state root itself is done, on whatever branch you want
that cleanup commit to land on.

## 4. Extract-replacement recipe

`flume job extract` is gone; there is no engine replacement, by design (the
clean-history ending is the implementation's branch strategy now, not
engine machinery — v0.11 §1/§3). Where extract's clean-history behavior is
still wanted — a deliverable branch with no harness commits on it, for a
target where squash rights are absent — reproduce it with ordinary git:

1. **Run the job on a side branch.** This was already true pre-0.11 (a
   `job/<name>` branch, or now any branch you choose) — nothing to change
   here.
2. **Fork the deliverable branch off the target base:**
   ```sh
   git checkout -b docs-refresh-clean main
   ```
3. **Integrate.** Squash-merge the side branch onto the fork for a single
   clean commit (`git merge --squash job/docs-refresh && git commit`), or
   cherry-pick individually if only some commits belong:
   ```sh
   git cherry-pick <sha1> <sha2>   # pick the non-harness commits you want
   ```
   Either way this is the operator's judgment call — which commits are
   "the deliverable" versus "harness ticks" is exactly the domain knowledge
   extract's cherry-pick filter used to encode as a path prefix
   (`.flume/jobs/<name>`); a human doing the integration already knows which
   commits matter without that heuristic.
4. **Route anything the job's state root was collecting for you by hand** —
   a declared `Chain.friction` dir's notes, an `open-questions.md`, or
   whatever `Chain.harvest` used to print to stdout. These are ordinary
   tracked or gitignored files in `.flume/jobs/<name>/`; read them off the
   working tree (or `git show job/<name>:<path>`) the same way you'd read
   any other file at that commit.
5. **Push and clean up:**
   ```sh
   git push origin docs-refresh-clean
   flume job rm docs-refresh   # once the side branch's job is done with
   ```

## 5. If your chain declares `Chain.harvest`

`Chain.harvest` has no consumer left — `flume job extract` was the only
reader — so it's dead configuration. Delete the field from your
`.flume/chain.ts`; nothing loads or validates it anymore, so leaving it in
place is inert rather than broken, but it will confuse the next person who
reads the chain looking for what still matters. `Chain.seedDir` and
`Chain.friction` are unaffected — both survive unchanged.

## 6. Symptom → cause table

| Symptom | Cause |
| --- | --- |
| `flume job new`/`flume job run` no longer creates or checks out a `job/<name>` branch | Expected — v0.11 §2/§3 retires the branch grammar. The job runs on whatever branch HEAD is already on; see §1 above. |
| `flume job extract` is not a recognized verb | Removed outright (v0.11 §3), no replacement shipped in the engine. Use the recipe in §4 above. |
| A chain's `Chain.harvest` declaration is accepted but never seems to do anything | It has no consumer post-0.11 — see §5. |
| `tick`/`loop` used to refuse with a wrong-branch error under `--job`; now they just run | Expected — the HEAD-guard preflight is removed (v0.11 §2). The engine has no opinion on which branch a job runs on. |
| A stale `job/<name>` branch is sitting around from before the upgrade | Not touched by 0.11 automatically — integrate or abandon it yourself, per §3. |
| `chain.ts must default-export a chain factory` | Your chain still default-exports a `Chain` object. Move it to the factory shape, per §2. |
| A globally-invoked `flume` died with `ERR_MODULE_NOT_FOUND: Cannot find package '@dtmd/flume'` | Pre-0.11 shape: the chain resolved the engine by walk-up from its own directory, which cannot reach a global install. Fixed by §2 — the chain no longer resolves an engine at all. |
| Unexplained `instanceof` failures, or a gate/agent behaving as if its module state were empty | Two engine copies in one process (pre-0.11). Fixed by §2. |
| A `safeParse`/gate run threw `TypeError: Cannot read properties of undefined (reading 'traits')` from inside `zod`, naming neither your `entryExtension` field nor a version | The pre-0.11 failure §7 below retires: your bay's `zod` copy and the engine's `zod` copy skewed, and `composePendingList` used to merge your schema object directly into the engine's own graph. See §7 — no action needed, just an explanation if you've already hit this. |

## 7. `entryExtension` validators: no migration step

`EntryExtensionField.schema` widened from `z.ZodTypeAny` to `StandardSchemaV1`
(v0.11 §11). Every zod schema already implements `~standard` (zod ≥3.24), so
an existing `entryExtension` declaration compiles and parses exactly as
before — there is nothing to change in `.flume/chain.ts`.

What this retires: previously, `composePendingList` merged your declared zod
objects directly into the engine's own zod schema graph
(`PendingEntryCore.extend(...)`/`.and(...)`), which only worked while your
bay's `zod` and the engine's `zod` were the same physical module copy. A
skewed copy (observed: engine on `4.0.17`, bay on `3.25.76`) composed
*silently* — no load-time error — and then threw
`TypeError: Cannot read properties of undefined (reading 'traits')` from
inside zod's own internals on every `safeParse`, escaping `parsePending`'s
structured `ParseResult` contract entirely and naming neither the field nor
the skew. The engine now *adapts* your declared validator (calls
`~standard.validate` on it) instead of merging the object, so no chain-side
zod copy ever enters the engine's schema graph again — the failure mode is
closed by construction, not guarded against.

If your extension's `tests: .default([])`-style field (or any field whose
validator supplies a value for a key your plan output omits) behaves
differently post-upgrade, that is unexpected — the adapter is
value-preserving by design (RELEASE-v0.11.md §11) and file it as a bug, not
a migration step.

## Non-goals

This guide does not perform any downstream bay's branch integration —
whether to merge, squash, or abandon a given `job/<name>` branch is a
judgment call about that branch's content, made by whoever owns the target.
It also does not add or recommend any replacement automation for `extract`;
per [`spec/jobs.md` § A job is a state root](../spec/jobs.md#a-job-is-a-state-root),
no such replacement is in scope for this line, and none is planned as engine
surface.
