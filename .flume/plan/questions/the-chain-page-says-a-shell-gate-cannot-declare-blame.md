# `spec/chain.md` says a shell gate cannot declare blame; the engine now lets it

A declared command gate's reader shipped (A-DECLARED-COMMAND-GATE-READS-ITS-OWN-OUTPUT):
`shellGate` takes a `read` over the run it captured — both streams apart, the
status the child exited with — and what that function returns *is* the gate's
result, blamed files and span-blame included. Verified on this tree: the
capability is on the engine (`read?: ShellGateReader`, `src/builtinGates.ts`),
and `harness/declaredGates.ts` hands a declaration's function through without
decoding anything itself.

Two corpus sections now disagree with each other, and phases cannot touch
`spec/`, so this needs a directed pass.

- `spec/harness.md`, *What a consumer declares* — the `gates` row — already
  says a shell or script gate "may declare a reader over what its command
  wrote … and what the reader returns is the gate's result: its verdict, the
  files it blames, whether it skipped, whether the failure is the span's."
  That row is what the entry shipped to.
- `spec/chain.md`, *The builtin gates* — the `shellGate` bullet — still says
  "Verdict is exit code alone, and so is blame: no shell-backed gate observes
  a base, so none can declare `blamesSpan: false`", and its signature line
  lists no `read`.

`spec/chain.md`'s *What a gate returns* rows need nothing: `failingFiles?` and
`blamesSpan?` are stated generically there ("when the gate's runner can name
them", "a declared fact"), and the two doc comments that *did* carry the
retired claim (`GateResult.failingFiles`, `GateResult.blamesSpan`) were
re-homed in the shipping commit. `docs/CHAIN-AUTHORING.md` grew the reader's
own section in that commit too. The `shellGate` bullet is the only live
residue.

## Option A — the row is the stale half

Grow the signature with `read?`, drop the blame sentence, and keep what
survives it: the exit-status-alone reading is still the whole verdict for a
gate that declares no reader, and the consecutive-identical-failure abort is
still what bounds a trunk already red. That is one bullet's edit.

## Option B — the reader does not belong on `shellGate`

The blame sentence is the target and the engine overreached: a shell gate
observes no base, so a reader claiming `blamesSpan: false` is claiming
something its command could not have seen. This means reverting `read` from
the engine's gate and re-deciding where a declared reader stands — which the
entry's own finding argues against, since `details` folds the two streams and
a harness-side reader would be re-parsing a fact the engine already decoded
(`.claude/rules/engineering.md`, *A fact the engine holds is reported, never
rediscovered*).

**Recommendation: A.** The `harness.md` row is human-authored and demands
exactly this blame from a command gate's reader, so the engine shipped under
authority the corpus already granted; and the premise of the retired sentence
is about the *engine*, which observes no base, not about a consumer's command,
which may well run a base comparison of its own (`FLUME_BASE_SHA` reaches a
declared gate — `spec/harness.md`, *What a consumer declares*). What stays
yours either way: whether `blamesSpan` from a reader wants a stated bar — "the
command demonstrated it", rather than a reader's guess — since the engine
takes a declared fact at its word.

Source: build note A-DECLARED-COMMAND-GATE-READS-ITS-OWN-OUTPUT, drained this
tick.
