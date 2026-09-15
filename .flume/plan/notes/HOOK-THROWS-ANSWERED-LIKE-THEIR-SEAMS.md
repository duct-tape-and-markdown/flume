# Two judgment calls the spec left to the site

**1. A thrown `shouldRun` is recorded as `render-refused`.** spec/chain.md
calls it "a refused tick, not a decline" but names no mode, and the engine has
exactly four (`NO_COMMIT_MODES`). I reused `render-refused` — the one class
meaning "an upstream refusal, agent never invoked" — rather than mint a fifth,
which would be a spec change. The record's `failures` opens `shouldRun hook
threw:` so a retry can tell the two producers apart. If the human wants the
fifth mode, that reopens `src/Prompt.ts`'s taxonomy and every precedence table
keyed on it.

**2. `TickVerdictMergeOutcome` gained `threw?: string`.** "the verdict names
the throw, as it names a declined ship" only holds if a throw is
distinguishable from a returned `false` — otherwise a broken predicate reads
back as a deliberate park. The field is set only on a `not-shipped` outcome a
throw produced. spec/loop.md's "The tick verdict" section does not name it;
the human may want it stated there.

Also: the message/stack decoding `runGate` did inline is now `throwFacts` at
module scope, shared by both seams.
