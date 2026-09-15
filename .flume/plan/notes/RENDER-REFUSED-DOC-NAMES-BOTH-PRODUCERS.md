# The rendered `<prior-attempt>` block still reads spans-only

Shipped the type's comment and `failures`, plus the two adjacent copies of the
same claim: the `render-refused` line in `NO_COMMIT_MODES`' doc (also shipped
`.d.ts`) and the bullet in `docs/CHAIN-AUTHORING.md`.

Left standing — behavioral, not doc: the renderer arm at `src/Prompt.ts`
`case "render-refused"` tells the retrying agent "A previous attempt's prompt
could not even be rendered — one or more inline-exec spans failed to resolve
... something in the prompt itself is broken. Fix or remove the failing
command(s)", under heading `Failing span(s):`. For the hook writer
(`persistHookRefusal`, src/Dispatcher.ts) every sentence is false: the prompt
rendered fine and there is no failing command to remove. The agent is sent to
fix a span that does not exist.

Not folded in: it changes agent-facing prompt text, the record carries no
discriminant between the two writers (one `failures` string), and it wants a
`tests[]` line plus an update to `RENDER_REFUSED_INTRO`
(tests/Dispatcher.test.ts). Worth an entry — likely neutral wording over both
writers rather than a new record field.
