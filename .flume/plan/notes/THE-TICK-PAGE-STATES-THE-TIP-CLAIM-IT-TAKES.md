# spec/loop.md states both halves of the claim this entry corrected

The false claim had three prose copies, not one. Fixed all three: docs/CLI.md's
exit-1 sentence (the entry's target), README.md:363 ("`flume tick` alone takes
no claim - only `loop` does"), and the comment above the detached-HEAD refusal
in src/cli.ts (~1182, "A bare tick takes no claim itself"). The comment sat
eleven lines above the acquire it denied.

Not fixed, because it is in the spec locus: spec/loop.md's *Detached HEAD is
refused* bullet ends "`tick` refuses even though it takes no claim, so behavior
is identical whether or not a loop wraps it" - the opposite of what the same
page's *Scope* bullet (twelve lines above) states and what src/cli.ts:1272
does. Every downstream copy this entry found reads like a paraphrase of that
sentence, so the human maintaining spec/loop.md is where the family closes; a
fourth copy is otherwise one derive away.

Debt, no entry filed: nothing pins spec/loop.md against the runtime, so the
contradiction above is invisible to the suite. The sweep's retired-claim delta
only fires on deleted spec lines, and this line was never deleted - it was
outlived. Correcting a spec sentence is not a class the engine can hold, so
this stays an observation rather than a queue entry.

The new pin drives a real refusal: one `flume tick` over a scratch repo whose
tip claim is held by the vitest process (planted via renderPidClaim with a
state root, so both roots are in the refusal), beside the same tick with no
claim standing, which hibernates. Cheap - 0.9s, default lane, no agent.
