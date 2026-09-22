# The layers and their borders

Flume is three layers, and every finding of the last two releases was a
question about which layer a piece of code belonged to. This page names the
borders once: what each layer owns, how the layer outside it extends it, the
test that decides where a thing belongs, and which way a finding travels.

| layer | ships | who writes it | where it lives |
| --- | --- | --- | --- |
| engine | mechanism: ticks, worktrees, gates, verdicts, the job partition | flume | `src/`, `@dtmd/flume` |
| harness | opinion: phases, prompts, judges, records, plan state | flume | `harness/`, `@dtmd/flume/harness` |
| consumer | a declaration, and the facts of one stack | you | `.flume/declaration.ts`, `.flume/chain.ts` |

The rule that ties the borders together is **extensible inward**: a layer
extends the one inside it only through that layer's declared points, and
never by rebuilding what the inner layer already holds. Code that re-derives
an inner layer's fact is not drift in the outer layer. It is a missing point
one border in, and the finding files inward.

## Border 1 — engine to harness

**What the engine owns.** Everything a tick needs to run and nothing about
what it should produce: the baton, worktree provisioning and reclamation,
gate invocation, the fence, the tick verdict, prior attempts, the job
partition, the agent adapter. The engine validates only what its own
mechanics consume (`.claude/rules/engine-boundary.md`).

**How the harness extends it.** Through typed injection points — a chain
declares fences, gates, channel paths, phases and their prompts, a handoff,
supervisor policy, an entry extension. The harness is one chain, written by
flume, applied to a declaration.

**The test.** Would an unrelated implementation — a different workflow, a
different stack — want exactly this behavior, or would it want to choose? If
it would choose, the behavior is the harness's, never the engine's. Every
`src/` change passes this test; a behavior the harness wants that fails it
stays in `harness/`.

**Which way a finding travels.** A chain that re-parses an agent stream the
engine already decoded, copies a filename rule the engine owns, or infers
whether a phase ran from the shape of its commit is evidence against the
engine, not the chain: the engine failed to report a fact it held
(`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
rediscovered*). The finding names the missing surface, and the chain's copy is
deleted when the surface lands.

## Border 2 — harness to consumer

**What the harness owns.** The discipline: which phases run and when, what
each prompt says, how a `tests[]` line is judged, what a record is, how plan
state is kept, what the fence refuses. A consumer enables, disables, and
declares; it does not re-author (`spec/harness.md`).

**How a consumer extends it.** Through the declaration's fields, each a typed
place for a value the harness does not choose — and, beside the declaration,
the entry fields the chain factory takes:

- `specLocus` and `fence` — where a `per` cite may point, and what build and
  each plan slice may write;
- `slices` — which plan slices run, and the sweep's domain and posture pages;
- `runner` — a factory over the judge's interface; vitest and script runners
  ship, anything else is declared;
- entry fields — a schema beside a hint, rendered into the plan prompt by
  the same renderer as the package's own, so a consumer's parser and the
  prompt that fills it cannot drift;
- `slots` — text the prompts quote, context and never a directive;
- `gates` — by registry name, shell, or script, run under the `shell` the
  declaration names with the engine's gate facts in their environment;
- `resolver` — how a `per` cite's section is found, where heading text is not
  how this consumer's spec is keyed;
- `channelPaths` and `scopeWritesToEntry` — what a build tick writes beside
  its commit, and whether a fanout tick's writes narrow to its entry;
- `jobs` — a named fence and spec locus per unit of work in one checkout;
- `capabilities` — the environment facts a repository asserts, which decide
  whether a capability-gated entry is pickable;
- `worktreesBase` — where this repository's worktrees are planted, a
  function of the roots the engine resolved rather than a path a committed
  declaration could hold;
- `setup`, `agents`, `supervisor`, and the findings sources the inbox slice
  drains — `ci`, the lanes it reads off the forge, and `friction`, the
  engine's loop-to-owner channel, whose files it routes as it routes the
  inbox's;
- `handoff` — overridable per phase, for a consumer whose wake rules differ.

**The test.** Would every consumer write this block identically? Then it is
not a consumer concern: it is a declaration field the harness owes, and until
the field exists the block is a position held rather than drift
(`.claude/rules/engine-boundary.md`, *Surface, not prescription*).

**Which way a finding travels.** Into `.flume/inbox/` here, one record per
finding, under 1,200 bytes, saying what was observed, where, and why it
matters (`.flume/PROTOCOL.md`, *Records: one file each*). The plan slice
drains it into an entry, a question for the operator, or a declined line
with its reason, and the record is deleted. The repository is public: a
consumer's finding is a pull request adding one file.

## Border 3 — consumer to repository

**What the consumer owns.** The facts of one stack, which no second consumer
would want: the solution a build gate compiles, the restore script a
worktree runs, the model roster, a timeout derived from that repository's own
measured invocations. These live in the declaration's values and, where a
value has behavior, in `chain.ts` — which stays the consumer's to compose or
bypass.

**The test.** Would a second consumer on a different stack want a different
value here? Then it is theirs, and correctly so.

**Which way a finding travels.** Nowhere. A stack fact is not a finding.

## A worked example

One consumer audited its hand-written chain, 947 lines, and sorted every
identifiable line by the border it belonged to:

| stratum | lines | border |
| --- | --- | --- |
| telemetry, structural liveness, a re-dispatch brake | 149 | engine's: facts it held and reported nowhere |
| prompt arguments, a friction reader, entry-field hints | 106 | harness's: prompts the package owns |
| a per-job schema, reader, and `--job` plumbing | 167 | harness's: the `jobs` field, before it existed |
| a .NET restore, a build gate, an agent roster, tuning | 242 | the consumer's, correctly |

Six hundred of the nine hundred lines were the two inner layers' work, done
outside them because the border was not written where a consumer would read
it. The healthiest lines in the file were the ones that named the upstream
finding they were waiting on. That is what a hand-written chain is: not
drift, but a queue of findings the producer has not read yet.

## See also

- `spec/harness.md` — the harness's contract, and *What a consumer declares*.
- `.claude/rules/engine-boundary.md` — the first border, in full.
- `docs/CHAIN-AUTHORING.md` — writing a chain against the engine directly.
- `docs/MIGRATING-0.16.md` § 6 — adopting the package from a hand-written chain.
