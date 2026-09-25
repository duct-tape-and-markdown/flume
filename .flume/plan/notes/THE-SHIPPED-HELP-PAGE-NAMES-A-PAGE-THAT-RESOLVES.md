# A shipped prompt cannot name a state-root path, and cites into a consumer's page never resolve

Two things the page-name arm turned up once it reached the packed assets.

**The reds needed a surface, not a rewrite.** `harness/cliHelp.ts` could
interpolate `DEFAULT_STATE_ROOT`, but a prompt had nowhere to name
`<stateRoot>/PROTOCOL.md` from: `plan-discipline.md` is read off disk
unrendered, and its own line 3 claims every path it names is spelled in the
slice prompt's `<artifacts>` block — which listed no protocol path. So
`PROTOCOL_REL` moved from `harness/init.ts` to `harness/layout.ts` (one home
for where the page sits), `PROTOCOL` joined `SHARED_PROMPT_DATA_KEYS`, and the
three plan slice prompts' artifacts blocks carry `project conventions:
{{PROTOCOL}}`. Wider than the entry named; the entry's two prompt edits alone
would have hardcoded `.flume/` into a shipped asset.

**A cite from a shipped prompt into the consumer's own page cannot resolve.**
`plan-derive.md:40` cited (`PROTOCOL.md`, *What makes an entry good*). That
section titles neither `.flume/PROTOCOL.md` ("What makes an entry good, not
merely valid") nor the shipped `harness/templates/PROTOCOL.md` ("What an entry
means here") — the page every consumer's copy is generated from and then
edits. I dropped the section half rather than pick a spelling. The class is
worth a ruling: a shipped prompt may name a consumer-owned page, but any
section it cites there is a guess.

Same shape one step out: `harness/templates/PROTOCOL.md:11,58` cite
`spec/harness.md`, flume's own spec. The scan resolves it against this repo
and passes; in an adopting repo that path holds nothing. The template ships
dead pointers to every consumer, and no arm here can see it.
