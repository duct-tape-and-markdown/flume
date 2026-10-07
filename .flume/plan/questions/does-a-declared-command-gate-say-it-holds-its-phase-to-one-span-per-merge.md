# Does anything tell a consumer that declaring a `shell`/`script` gate holds its phase to one span per merge?

A build tick's note (2026-10-07, `THE-SHELL-BACKED-BUILTINS-DECLARE-THEY-READ-A-BATCH`)
observed this and called it a human call, so it comes here rather than to the queue.

## The shape

`shellCommand` (`harness/declaredGates.ts`) wraps a consumer's declared command line
in `gateFacts` — `FLUME_BASE_SHA`, `FLUME_LANDED_ON_SHA`, `FLUME_TOUCHED_PATHS` — which
are one span's facts, and an environment variable has no batch spelling (one variable
cannot carry N spans' shas). So it returns a `SingleSpanGate`, overriding `shellGate`'s
`batches: true` back to one span, and declares that at the site with its reason.

The consequence: a consumer who declares a `shell` or `script` gate at `afterMerge` and
raises `supervisor.mergeBatch` gets the serial carry, and nothing it reads before the run
says the gate it declared is what narrowed it.

## What already states the general rule (checked on this tip, so the answering session need not)

- `Chain.supervisorPolicy.mergeBatch`'s own doc comment — the hover text, engine surface —
  says a phase with one undeclared `afterMerge` gate "runs at a width of one whatever this says".
- `docs/CHAIN-AUTHORING.md`, *Reading a batched merge* says it twice, including
  "one gate without it holds the phase to a span per merge whatever this says".
- `spec/worktrees.md`, *Batched merges* states the rule and its reason.
- The effective width is in the operator log (`src/waveMerge.ts`, `N per merge`).

What none of them says is that the package's **own** declared gate kinds are instances of
that rule — the one thing a consumer declaring `{ kind: "shell", command: "..." }` would
need to connect the two. `spec/harness.md`, *What a consumer declares* is silent.

## Options

1. **A sentence in `spec/harness.md`, *What a consumer declares*** (and the `docs/`
   statement a plan entry could then cite): a declared `shell`/`script` gate carries the
   engine's gate facts, so it reads one span and holds the phase to one span per merge.
   Cheapest, and the prose rung is where a cross-surface consequence like this normally
   lives. Costs nothing at runtime and nothing in the engine.
2. **A batch spelling for the gate facts** — e.g. one variable per span index, or a
   `FLUME_BATCH` manifest the command reads — so a declared command gate can honestly
   declare `batches: true`. Buys consumers the width they asked for; costs a new
   channel contract for every command gate ever written against the current three
   variables, and the note's own reading is that no single-variable spelling works.
3. **Report the effective width as a fact** rather than narrating it: the engine computes
   `mergeBatchWidth` per tick (`src/gateBatch.ts`) and carries it only into a log line, so
   a chain cannot read what width its own tick ran at. Putting it on the tick verdict /
   `TickResult` would let a consumer see "I declared 4 and ran at 1" per tick, without
   anyone writing prose — but it says the width, never which gate narrowed it, so it is a
   complement to (1) rather than a substitute, and it is a separate finding against
   `engineering.md`, *A fact the engine holds is reported, never rediscovered*.

(1) and (3) compose; (2) is the only one that changes what a consumer can do. No entry is
filed for any of them: the spec sentence is the human's, and (3) is a reported-fact entry
nobody has asked for yet.

## One narrowing surface, not two

The queue carries `THE-CHAIN-LOAD-GATE-DECLARES-IT-READS-A-BATCH`: `chainLoadGate` reads
four facts a batch states in full, so its withholding has no cause and goes. Whoever
answers this question reads the queue first — once that entry has shipped, a declared
`shell`/`script` gate is the **only** thing a consumer can hang at `afterMerge` that
narrows the phase, so (1)'s sentence carries the whole rule rather than one instance of
it, and a sentence naming `chainLoadGate` as a narrowing builtin would be false.
