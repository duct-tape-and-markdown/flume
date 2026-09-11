# clean-exit shipped; chain.ts still carries the dead `voluntary-bail` arms

`NoCommitMode` no longer has a `voluntary-bail` member — the engine emits
`clean-exit` only. `.flume/chain.ts` reads both as `string`, so nothing
breaks, but two arms are now unreachable and owe the chore the entry named:

- `REFUSAL_MODES` (:584) still lists `"voluntary-bail"`.
- `bailed` (:879) still tests `mode === "voluntary-bail"`.
- The doc comment at :580-582 and the aside at :877 both narrate the
  transition and expire with it (`engineering.md`, *Narration is the
  ladder's bottom rung* — the trigger has now fired).

`.flume/plan/open-questions.md:58-60` carries the parked question this
unblocks; it can close.

Also renamed, for anything reading the record shape: the record's
`constraint` field is now `finalMessage`, and the rendered
`<prior-attempt>` label is "Prior attempt's final message (tail,
verbatim):" rather than "Refused constraint". A chain matching on either
string needs updating; nothing in this repo does.
