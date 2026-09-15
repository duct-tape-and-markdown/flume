# Migrating to 0.16.0

> **Dated record.** Describes the 0.15.0 → 0.16.0 upgrade as it stood at the
> cut, not flume as it ships now.

From **0.15.0**. Five breaking changes, every one of them a rename or a
default the engine now takes — no chain restructuring, no new required
declaration. Each section below names who is affected and gives the before
and after call shape; if the `grep` at the head of a section finds nothing in
your chain, that section is a no-op for you.

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
grep -n "entryTag" .flume/chain.ts                    # § 1
grep -rn "mergeOutcomes\|invocations" --include='*.mjs' --include='*.ts' .   # § 2
grep -n "priorAttemptPath\|priorAttempts" .flume/chain.ts                    # § 3
grep -n "claudeCode\|mcp" .flume/chain.ts             # § 4
grep -n "gateResults\|TickVerdictGateResult" .flume/chain.ts                 # § 5
```

§ 4 is the one that changes behavior with no symbol to grep for — read it
even if your chain never mentions MCP.

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
| a vitest invocation the judge drives | `runner: vitestRunner()`; cargo, dotnet or a script means declaring your own factory over `run` / `runAtBase` / `lanes` |
| where a `per` cite may point | `specLocus` |
| a typed spec resolved other than by heading text | `resolver` |
| `handoff` | `handoff`, **per phase** — overriding build's routing never means copying the slice ladder |
| which plan phases exist | `slices.enabled`; `plan-sweep` additionally needs `sweep.domain` and `sweep.posturePages` |
| prompt preamble text you want kept | `slots.autonomy` / `slots.domain` — text only; a slot cannot add a directive the package's discipline already states |

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
- [`MIGRATING-0.12.md`](MIGRATING-0.12.md) — the previous note in this series;
  0.13, 0.14 and 0.15 shipped breaking changes with no note of their own, so a
  consumer jumping more than one minor should read those releases'
  `### Breaking` sections in [`../CHANGELOG.md`](../CHANGELOG.md) as well.
