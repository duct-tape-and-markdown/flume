# Migrating to 0.16.0

> **Dated record.** Describes the 0.15.0 → 0.16.0 upgrade as it stood at the
> cut, not flume as it ships now.

**This note does not cover 0.13, 0.14 or 0.15.** The previous note in the
series is [`MIGRATING-0.12.md`](MIGRATING-0.12.md), and each of the three
minors between it and this one shipped breaking changes with no note of its
own. If your pin is below `0.15.0`, read those three releases' `### Breaking`
sections in [`../CHANGELOG.md`](../CHANGELOG.md) before treating this note as
the whole upgrade — the sections below describe the `0.15.0` → `0.16.0` step
and nothing earlier. The break most likely to survive a jump unnoticed is
0.15's `voluntary-bail` → `clean-exit` rename, which no typecheck catches in
a chain that reads the mode as a bare string; § 3 shows the read that turns
it into a compile error.

From **0.15.0**. Five breaking changes, every one of them a rename or a
default the engine now takes — no chain restructuring, no new required
declaration. Each section below names who is affected and gives the before
and after call shape; if the `grep` at the head of a section finds nothing in
your chain, that section is a no-op for you.

Ahead of all five is **§ 0**, which is not a 0.16 change at all: the
`package.json` beside your `chain.ts`. It is the only step on this page whose
absence costs a *working* chain, and it is due whether or not you take this
upgrade.

0.16 also ships the **harness package** (`@dtmd/flume/harness`), flume's own
plan/build workflow as a declared environment rather than a chain you write.
Adopting it is opt-in and orthogonal to the five breaks: § 6 is for consumers
who want it. A hand-written chain that does §§ 1–5 keeps working and owes
nothing to § 6.

Note that **a caret range on a `0.x` version pins the minor** — `^0.15.0`
resolves within `0.15.x` and will never pick up `0.16.0` on its own. Change
the pin explicitly.

## Which sections apply to you

```sh
cat .flume/package.json                               # § 0 — first, whatever else
grep -n "entryTag" .flume/chain.ts                    # § 1
grep -rn "mergeOutcomes\|invocations" --include='*.mjs' --include='*.ts' .   # § 2
grep -n "priorAttemptPath\|priorAttempts" .flume/chain.ts                    # § 3
grep -n "claudeCode\|mcp" .flume/chain.ts             # § 4
grep -n "gateResults\|TickVerdictGateResult" .flume/chain.ts                 # § 5
```

§ 4 is the one that changes behavior with no symbol to grep for — read it
even if your chain never mentions MCP. § 0 is the one whose `cat` printing
`No such file` is the finding.

## 0. Before anything else: the manifest beside your chain

**Affects** every consumer whose state root carries no `package.json` — a
hand-written chain and an adopted harness alike, on 0.15 exactly as much as on
0.16. It is not one of the five breaks, and it is not gated on your version
bump: a chain still pinned to 0.15 needs it exactly as much.

```sh
cat .flume/package.json     # "No such file"? then, now:
printf '{\n  "type": "module"\n}\n' > .flume/package.json
```

That is the whole file. It declares the module scope of what sits beside it —
`chain.ts`, and `declaration.ts` if you adopted the harness — and nothing
else. Your repository's own manifest is untouched, so a CommonJS package
adopts flume and goes on being a CommonJS package.

**Why it is urgent.** `tsx` loads `.flume/chain.ts` in the module mode the
nearest `package.json` declares. With none beside `chain.ts` and no
`"type": "module"` in your own manifest, that mode is CommonJS — and flume is
ESM-only. Measured against the published 0.16.0 on linux:

| what your chain imports | node 22.20 | node 22.23 | node 24 |
| --- | --- | --- | --- |
| a runtime value from `@dtmd/flume` | loads | **fails** — `Cannot find module …/dist/…/index.js?namespace=…` | loads |
| the chain `flume-harness init` writes | **fails** — `Cannot find module './declaration.js'` | **fails** | loads |
| types only | loads | loads | loads |

A node **patch** upgrade crosses that boundary. A chain that ran green
yesterday is one `nvm install` from not loading at all, with nothing in
flume's own version having moved. The bottom row is not safety: a chain that
imports only types never loads the package at runtime, and the first runtime
import — the first gate helper, the first `vitestRunner()` — puts it on the
top row.

Where the loader failure is recognizable, 0.16 refuses it by name: the chain
load exits `2` and states this fix rather than relaying the loader's stack
trace (`docs/CLI.md`, *`flume tick`*). The 22.20 shape above is not one of
those — it reads as a plain missing module — so write the file rather than
waiting to be told about it.

A `tsconfig.json` does not substitute; `tsx` reads the manifest for module
scope, not the compiler options. Nor does adopting exempt you: the
`flume-harness init` of the 0.16.0 cut did not write this file, though later
versions do (`docs/CLI.md`, *`flume-harness init`*) — which is why the step
opens with a `cat` and not a write.

## 1. `setupWorktree` / `teardownWorktree`: `entryTag` is `worktreeKey`

**Affects** any chain declaring either worktree hook.

The setup context's field is renamed. The value and its rule are unchanged —
the pending entry's tag on a fanout tick, the phase name on a singleton one,
never absent — and `teardownWorktree` still receives the same key its
`setupWorktree` did.

```ts
// 0.15
setupWorktree: async ({ worktreePath, repoRoot, entryTag }) => {
  await install(worktreePath, scratchFor(entryTag));
},

// 0.16
setupWorktree: async ({ worktreePath, repoRoot, worktreeKey }) => {
  await install(worktreePath, scratchFor(worktreeKey));
},
```

The rename is the whole change: one name per rule. `entryTag` is now the name
of the *entry*, everywhere the engine reports one — the agent invocation
(`AgentInvocation.entryTag`, new in 0.16) and both verdict rows (§ 2) — and
that name carries the opposite absence rule: absent under singleton, where the
worktree key falls back to the phase name. Two rules cannot share one spelling.
If your hook read `entryTag` expecting the entry, note that it
never got only the entry: on a singleton tick it has always been handed the
phase name, and a hook that keyed scratch state off it was already mixing the
two keyspaces. Now the name says so.

`WorktreeSetupContext` is still the exported type name; only the field moved.

## 2. The tick verdict names the entry `entryTag` on every row

**Affects** anything reading `tick-verdicts.jsonl` or `flume log --json` —
dashboards, `jq` scripts, a chain's own history reader over
`api.readTickVerdicts`. No chain hook changes.

Two rows carried the entry under the spelling `tag`. Both now use `entryTag`,
the same name and absence rule as everywhere else the engine reports a
provisioned entry (absent on a singleton phase's own span, which has no entry
to name).

```jsonc
// 0.15 — one line of tick-verdicts.jsonl, elided
{
  "invocations":   [ { "tag": "SOME-ENTRY", "promptPath": "…" } ],
  "mergeOutcomes": [ { "tag": "SOME-ENTRY", "outcome": "merged" } ]
}

// 0.16
{
  "invocations":   [ { "entryTag": "SOME-ENTRY", "promptPath": "…" } ],
  "mergeOutcomes": [ { "entryTag": "SOME-ENTRY", "outcome": "merged" } ]
}
```

```sh
# a jq reader spanning the upgrade
jq '.mergeOutcomes[] | (.entryTag // .tag)' .flume/tick-verdicts.jsonl
```

`flume log`'s rendered human table is unchanged.

The log is append-only and nothing rewrites it, so **lines written by 0.15
keep the old key**. The engine's reader does no translation: a pre-upgrade
merge row parses fine and its tag simply goes unread, which renders as a bare
outcome with no tag prefix in `flume log`. That is cosmetic and confined to
history; new lines carry the new key. Use the `//` fallback above in any
reader that spans the cut, or key your reporting off lines written after it.

## 3. Prior-attempt records are scoped by keyspace

**Affects** a chain that calls `priorAttemptPath`, or that reads
`TickContext.priorAttempts` / the verdict's `clearedPriorAttempts` by key.
Reading a record's *fields* is unchanged.

A phase name and an entry tag that slugify onto one stem shared a record file:
`plan_sweep` and `PLAN-SWEEP` both landed at `prior-attempts/plan-sweep.json`,
so the second write overwrote the first's record and handed the next tick a
predecessor it never had. The keyspace is now part of the address, on disk and
in the map.

**On disk** — `prior-attempts/<keyspace>/<slug>.json`, where `<keyspace>` is
the engine's own closed set, `entry` or `phase`:

```
0.15   .flume/prior-attempts/some-entry.json
0.16   .flume/prior-attempts/entry/some-entry.json
       .flume/prior-attempts/phase/build.json
```

**The path helper** takes the ref whole, so a caller cannot name a record
without saying which keyspace it is in:

```ts
// 0.15
priorAttemptPath(flumeDir, entry.tag);
priorAttemptPath(flumeDir, phase.name);

// 0.16
priorAttemptPath(flumeDir, { keyspace: "entry", key: entry.tag });
priorAttemptPath(flumeDir, { keyspace: "phase", key: phase.name });
```

The helper slugifies the key itself and is idempotent on an already-slugified
one, so either spelling of a tag reaches the same file. The parameter is
structural — pass the object literal; there is no type to import.

**The map** a hook reads is keyed by keyspace and identity joined, and here
the entry half *is* the slug:

```ts
// 0.15
ctx.priorAttempts.get(api.slugify(entry.tag));
ctx.priorAttempts.get(phase.name);

// 0.16
ctx.priorAttempts.get(`entry:${api.slugify(entry.tag)}`);
ctx.priorAttempts.get(`phase:${phase.name}`);
```

A lookup by bare identity now finds nothing — it does not throw, it misses, so
a `shouldRun` that gates on "have I failed here before?" will read every tick
as a first attempt until the key is updated. That is the one failure mode in
this section worth grepping for deliberately. `clearedPriorAttempts` on the
verdict reports the same composed keys.

**Reading the record.** The lookup is one half of how that `shouldRun` goes
quiet. Reading the result untyped is the other, and the two travel together —
a chain that addressed the record by hand usually decoded it by hand too:

```ts
// the shape that typechecks and never fires
const rec = ctx.priorAttempts.get(api.slugify(entry.tag)) as
  | { mode?: string }
  | undefined;
if (rec?.mode !== "voluntary-bail") return true; // renamed in 0.15 — true forever
```

A cast to `{ mode?: string }` accepts every string, so a mode an earlier
release renamed still compiles and simply compares false for the rest of the
chain's life. Nothing reds; the brake just stops braking. The record's fields
did not change in 0.16, but reading it through the types the package exports
makes that half a compile error, and leaves only the key to get right:

```ts
import { type PriorAttempt, type PriorAttemptMode } from "@dtmd/flume";

// the modes this chain brakes on, stated once against the engine's own union
const BRAKE_ON: readonly PriorAttemptMode[] = ["gate-revert", "clean-exit"];

shouldRun: async (ctx) => {
  const entry = ctx.assignedEntry;
  if (entry === undefined) return true;
  const rec: PriorAttempt | undefined = ctx.priorAttempts?.get(
    `entry:${api.slugify(entry.tag)}`,
  );
  return rec === undefined || !BRAKE_ON.includes(rec.mode);
},
```

`PriorAttemptMode` is every mode a record can carry and `PriorAttempt` is the
mode-tagged union itself, so a spelling the engine no longer mints is a type
error at the line that names it, and narrowing on `rec.mode` reaches the
variant's own fields — `finalMessage` on a `clean-exit` record, not the
`constraint` the same rename retired.

**Record shape.** Every record now carries `key` (its keyspace) and `keyedAs`
(the identity it was written under) beside the `headSha`/`at` anchor, and a
record missing either — or whose stated keyspace disagrees with the directory
it sits in — reads as **absent**, the same degrade an unrecognized `mode`
already earned.

**Records written before the upgrade** sit flat under `prior-attempts/` and
are no longer read or swept. They are gitignored runtime state: delete the
directory or leave it, either is correct. A repository upgrading mid-loop
loses at most one retry's context.

## 4. A tick loads only the MCP configuration the chain hands it

**Affects** every consumer on `claudeCode`, whether or not their chain
mentions MCP. This is the one break with no symbol to grep for — the default
changed underneath you.

A headless `claude -p` boots every MCP server the *invoking user's own*
configuration names, so an autonomous tick inherited by-user runtime state
through the binary — the one thing a stateless tick exists to exclude. A
wedged inherited server has held a finished agent's process open and stalled a
whole fanout wave.

The adapter now rides `--strict-mcp-config` on every invocation.

```ts
// 0.16 default: --strict-mcp-config on the argv, user config not loaded
claudeCode({ model: "…" });

// 0.15 behavior, opted into by name
claudeCode({ model: "…", inheritUserMcp: true });

// or: keep the strict default and hand the tick its own config
claudeCode({ model: "…", extraArgs: ["--mcp-config", ".flume/mcp.json"] });
```

**The symptom if you were depending on inheritance without knowing it:** an
agent that used to reach a tool now cannot, and the tick fails as a task
failure rather than a configuration error — the agent reports it could not
find the tool, no gate fires, no flag names MCP. If a phase's prompt names an
MCP tool by name, decide before upgrading which of the two lines above that
phase should take.

`inheritUserMcp: true` is the deliberate, named opt-out; reaching the same
result by adding the flag's inverse through `extraArgs` is not available (the
flag is omitted, not negated).

## 5. `TickVerdictGateResult` is `ReportedGateResult`, and the hooks get the whole row

**Affects** a chain that imports the type by name, and — for the better — any
`handoff` or `shipped` that reads `gateResults`.

`handoff` and `shipped` received a three-field narrowing of a row the
dispatcher builds with more. `details`, `verdict`, `skipped` and
`failingFiles` rode through the same array at runtime; the type was the only
thing hiding them, so a chain wanting a discriminant its own gate authored had
to pattern-match the gate's prose back out of `message`.

One row shape now serves every reporting surface — the tick verdict on disk,
the handoff result, the ship context — and it is renamed to stop claiming the
verdict owns it. Renamed in place, pre-1.0: no alias is shipped.

```ts
// 0.15
import { type TickVerdictGateResult } from "@dtmd/flume";
// TickResult.gateResults: readonly { gate, ok, message }[]

handoff: ({ gateResults }) => {
  // the only way to recover a gate's own finding: parse its prose
  const flaky = gateResults.some((g) => /known-flaky/.test(g.message));
  …
},

// 0.16
import { type ReportedGateResult } from "@dtmd/flume";
// TickResult.gateResults / ShipContext.gateResults: readonly ReportedGateResult[]
// gate, ok, message, details?, verdict?, skipped?, failingFiles?

handoff: ({ gateResults }) => {
  // the gate's own chain-authored verdict, read rather than reconstructed
  const flaky = gateResults.some((g) => g.verdict === "known-flaky");
  …
},
```

Nothing widens or narrows on the way out, so the rows a hook sees are the rows
the verdict records. If your chain reconstructed any of the four newly-visible
fields from `message`, delete the parser — that rebuild is what this change
exists to end.

## 6. Adopting the harness package from a hand-written chain

**Optional.** The engine is unchanged by this section: a hand-written
`.flume/chain.ts` on 0.16 is fully supported, and §§ 1–5 are the whole upgrade
for one. Read on only if you want flume's own workflow instead of your own.

### What it is

`@dtmd/flume/harness` is flume's opinion about how to run the engine, shipped
in the same npm package at the same version: three plan slices
(`plan-inbox`, `plan-derive`, `plan-sweep`) plus a fanout `build` phase, their
prompts, the entry schema extension, the `tests[]`/`pins[]` judge, the
discipline gates (`per`, records, clean-tree, pending), the records
conventions, the plan state, and the default handoff. You declare an
environment; the package's factory returns the whole `Chain`.

```ts
// .flume/chain.ts — the same three lines in every consumer that adopts
import type { ChainFactory } from "@dtmd/flume";
import { harnessChain } from "@dtmd/flume/harness";
import { declaration } from "./declaration.js";

const factory: ChainFactory = (api) => ({
  chain: harnessChain({ api, declaration }),
});

export default factory;
```

Everything you decide lives one file over, in `declaration.ts`, validated by
the package's strict schema at chain load: an unknown field or a missing
required one refuses the load naming the field, never read as a silent
default.

### `flume-harness init` refuses over an existing state root

The package ships its own bin beside the engine's `flume`, so the engine's
verb set stays closed:

```sh
# from a repository that does not carry the package yet — init adds it
npx --package=@dtmd/flume flume-harness init

# or, once it is a dependency
pnpm exec flume-harness init
```

It writes `<stateRoot>/declaration.ts`, `<stateRoot>/chain.ts`,
`<stateRoot>/PROTOCOL.md`, an empty `plan/pending.json` (nothing else creates
one, and a plan slice refuses over an absent queue), merges the runtime ignore
lines into `.gitignore`, and adds the package to your `package.json`. Every
input is resolved before the first byte is written, so a refusal leaves the
repository untouched.

**It refuses when the state root already exists**, and it takes no arguments —
so a repository with a hand-written chain at `.flume/` cannot run the verb
in place. That refusal is deliberate: a repository with a state root has a
declaration someone edited, and "is this adoption or an upgrade?" has one safe
answer. Two ways through:

- **Adopt into a fresh root.** Move the old one aside
  (`git mv .flume .flume-old`), run `init`, port the declaration (below), then
  delete the old root once a tick runs green. Your queue and plan artifacts
  are the package's to re-derive; do not copy them over.
- **Call it programmatically**, which does take a state root:
  `harnessInit({ repoRoot, stateRoot: "flume" })`, exported from
  `@dtmd/flume/harness`. The package requires the root to resolve **inside the
  repository** and refuses a relocated one at chain load — every mechanic it
  wires addresses a path some commit holds.

What init writes once it never rewrites. Upgrading is a version bump plus the
release's migration note, never a re-run.

### Porting a hand-written chain

Most of what a chain carries has a declaration field. The rest is the
package's, and that is the trade:

| Your chain had | Declare |
| --- | --- |
| `writablePaths` per phase | `fence.build`, plus a per-slice entry for paths a plan slice may write beyond the package's own artifacts |
| `entryChannelPaths` | `channelPaths` |
| `scopeWritesToEntry` | same name, off by default |
| named / shell / script gates | `gates`, per phase and `when` — the package's discipline gates are always present and always first, and its judge runs after yours at the same `when` |
| the agent, per phase | `agents` — `model`, `extraArgs`, and `inheritUserMcp` (§ 4), off by default here too |
| `supervisorPolicy` | `supervisor`, passed through whole |
| `setupWorktree` installs | `setup` — directories to install, an optional restore command; run in every provisioned worktree, singleton and fanout alike |
| a vitest invocation the judge drives | `runner: vitestRunner()` — one value, if your suite is vitest. Cargo, dotnet or a script means a `RunnerFactory` of your own over `run` / `runAtBase` / `lanes`, and that is the largest single piece of the whole port: priced below |
| where a `per` cite may point | `specLocus` |
| a typed spec resolved other than by heading text | `resolver` |
| `handoff` | `handoff`, **per phase** — overriding build's routing never means copying the slice ladder |
| which plan phases exist | `slices.enabled`; `plan-sweep` additionally needs `sweep.domain` and `sweep.posturePages` |
| prompt preamble text you want kept | `slots.autonomy` / `slots.domain` — text only; a slot cannot add a directive the package's discipline already states |

#### Pricing the runner row

For a vitest suite that row costs `runner: vitestRunner()` and you are done.
For cargo, dotnet, a shell script, or anything else, it is the one cell in the
table that is a project rather than a value — price it before you commit to
adopting, not after.

What you write is a `RunnerFactory`: `(ctx) => Runner`, called once at chain
load, rather than a `Runner` you construct yourself. Two of the three
operations need what only the load holds. `ctx.api` is the engine surface your
factory is handed — `api.git.checkoutAt` for the tree at a base sha, and
`api.paths.flumeDir` to plant it under, so a run that dies mid-flight leaves a
directory the stale-worktree sweep reclaims rather than one nothing owns.
`ctx.provision` is your own declared `setup` already reduced to
a function, so the base checkout is provisioned the way a build worktree is and
you never re-derive that beside your declaration.

The three operations, and what each owes:

- **`run(names, cwd)`** — run the suite and return a `RunResult`: `ok`,
  `passed` (the count the judge reads to refuse a green verdict over zero
  tests), one `NamedResult` per requested line (`carried`, plus the
  run-relative `files` whose passing tests carried it), and a `TestFailure` per
  failure (the file it was attributed to, the failing test's full name where
  the file got that far, the message's first line). **Never an exit code** — a
  status would put the judge back to parsing your runner's prose. Most of the
  port lands here, and most of *that* is one question about your tool: can it
  report per-test names and per-file attribution machine-readably? Vitest's
  JSON reporter can. A bare `cargo test` exit status cannot, and the gap
  between them is yours to close.
- **`runAtBase(names, files, baseSha, cwd)`** — lay the working-tree bytes of
  `files` over a detached checkout of `baseSha`, run the same names there, and
  report the same shape. This is what proves a `tests[]` line fails before the
  change; without it the judge cannot tell a new behavior from one that already
  held. The checkout is the engine's and is reclaimed at the gate boundary, so
  this runs only inside a gate invocation, and `ctx.provision` is how its
  dependencies get there. A compiled language pays a build here per judged
  entry — that recurring cost, not the code, is usually the thing worth
  deciding on.
- **`lanes`** — declared, not discovered: each lane's name, the globs it
  excludes in your own tool's vocabulary, and exactly one carrying `runs: true`
  (the lane `run` and `runAtBase` actually execute). The running lane's
  exclusions are rendered verbatim into plan's `tests[]` and `pins[]` hints, so
  plan is told at authorship which files no judge will reach. `vitestRunner()`
  refuses at construction over none or several; in a factory of your own that
  invariant is yours to hold, and a lane set carrying no `runs` costs you the
  hint rather than a refusal.

`Runner`, `RunnerFactory`, `RunnerContext`, `RunResult`, `NamedResult`,
`TestFailure` and `Lane` are all exported from `@dtmd/flume/harness`, and the
shipped `vitestRunner()` is a working implementation of all three to read
against. What none of them can be is optional: `runner` is a required
declaration field, so there is no adopting first and porting the runner later.

**What has no declaration field**, verified against the factory's returned
`Chain` — check for these before you commit to adopting:

- `Chain.friction` — the friction channel and the `flume friction` verb.
- `Chain.seedDir` — so `flume job new` under the package seeds a bare job.
- `Chain.pendingPath`, `Chain.worktreesBase`, `Chain.capabilities`.
- **Phases beyond the package's own.** The phase list is the enabled plan
  slices plus `build`. A hand-written chain with a third phase (a release
  phase, a review phase) has nowhere to put it.
- **`shouldRun`, `shipped`, `promptArgs`, and the prompts themselves.** These
  are the package's discipline, not an environment: the slice windows decide
  when a plan phase runs, and `shipped` is what reads a build tick's park.
  A chain that encoded real policy in `shouldRun` — a zombie brake, a
  dirty-tree guard — is declaring behavior the package does not currently
  take, and that is the honest reason to stay hand-written for now.

A consumer never copies a prompt, a slice, or a judge from another consumer.
What it wants to change, it declares — and what it cannot declare is a gap in
the package, worth filing rather than working around in a chain the next
version bump will not carry forward.

### After adopting

- `pending.json` is the package's to derive; seed it empty (init does) and let
  a plan tick fill it. Hand-editing the queue is out of contract.
- The entry schema is the package's extension: a summary, a `per` cite, an
  acceptance criterion, `tests[]` and `pins[]`, a note, and the
  contract-touching flag the default handoff stops on. You may add fields; you
  may not remove the package's.
- One version bump moves the engine and the harness together — one package,
  one version, one `exports` map, so the engine minor and the harness that
  absorbs it cannot drift apart.

## See also

- [`CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md) — the full shape of every chain
  surface named above.
- [`CLI.md`](CLI.md) — `flume log`, `flume check`, `flume job`.
- [`MIGRATING-0.12.md`](MIGRATING-0.12.md) — the previous note in this series.
  What lies between the two is named at the head of this page.
