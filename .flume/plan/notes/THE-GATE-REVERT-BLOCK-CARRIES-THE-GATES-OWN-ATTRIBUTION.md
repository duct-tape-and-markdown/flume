# The gate-revert arm widened; a label collided and docs carried a retired claim

1. **`blamesSpan` stays off the shared fixture, deliberately.** The per-mode
case in tests/Prompt.test.ts reads every non-envelope field's lines off its
fixture, so a fixture carrying `blamesSpan: false` would demand the literal
`false` in prose that renders it as a sentence. The call taken: `verdict` and
`failingFiles` joined the shared `gateRevert` fixture (so that case covers
them), and `blamesSpan` did not — it selects prose, it is not a value the
block quotes, and it has its own named case. No boolean guard was added to
`ownFieldLines`: a guard nothing exercises is dead plumbing, and a later
fixture adding the field fails loudly rather than passing silently under an
exclusion. If plan wants the exclusion spelled, it needs a boolean field that
*is* rendered verbatim to be non-vacuous.

2. **`Verdict: <message>` was renamed `Gate message: <message>`.** The record
now renders two gate statements; one bare `Verdict:` label for the prose while
the chain-authored `verdict` discriminant had no line was unreadable. The pin
in tests/Dispatcher.test.ts moved with it. Anything downstream keying on the
old label breaks — it is prompt prose, not API, so nothing declares it.

3. **docs/CHAIN-AUTHORING.md asserted the retired claim** "The block above
renders `message` and `details` only — `verdict` is for the hook, not the
agent." Updated here, with the rendered sample and the `blamesSpan` passage.
Worth a lens: that page restates block content as a rendered sample, so every
widening of `modeLines` is a two-site change with nothing mechanical holding
the pair together.
