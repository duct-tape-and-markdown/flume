# The prompt-path prefix has one home; one hand-spelled site left out of scope

Shipped: `recordRenderedPrompt` (`src/tickAttempt.ts`) now returns
`RENDERED_PROMPT_PREFIX + name` rather than composing
`STATE_ROOT_NAMES.renderedPrompts` a second time, and the three
`tests/Dispatcher.test.ts` sites that hand-spelled `rendered-prompts/`
between the two sides now go through the constant or through
`renderedPromptName`. New pin drives a real tick's own verdict row through
the real retention call: a one-sided respell of the writer reds it
(measured — reverted the writer to `renderedPrompts/`, the pin failed at
the resolve).

Observed while here, left unfiled since it is outside this entry's files:

1. `tests/cli.test.ts` (the `invocation()` fixture helper in the `flume
   status` live-spend describe) still hand-spells `rendered-prompts/probe.md`.
   That describe's fold counts rendered prompts in the window *not* named by
   a row, so the prefix is load-bearing on both sides of that case and the
   fixture authors it by hand. Not the same defect as this entry's — the rows
   there are hand-authored facts, not a writer's output — but a respell would
   make the outstanding count silently agree with itself.
2. `tests/Dispatcher.test.ts:15223` also carries the literal, in a shape test
   (obstructed state root) where the value is incidental — left alone per
   *A seam gate reads what the real writer wrote*'s scope bullet.
3. Before this change the seam had an accidental gate: the singleton
   rendered-prompt case reads the file after the tick, and a drifted prefix
   makes the tick's own verdict-write trim delete it, so the case reds with a
   readFile ENOENT. The failure named the wrong thing; the pin now states it.
