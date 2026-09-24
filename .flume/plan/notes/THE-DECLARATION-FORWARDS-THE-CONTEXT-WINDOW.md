# The window forwards; nothing this repo runs declares one yet

`agents.<phase>.contextWindow` now parses and reaches the adapter as
`budget: { contextWindow }` — no cadence, no thresholds, per the entry's
ruling. Two observations for the next drain:

1. **No consumer declares one.** `.flume/declaration.ts` is outside build's
   fence, so this repo's own ticks still run with no budget line at all, and
   `harness/prompts/build.md`'s 70%/80% paragraph still reads as the "no
   budget line at all means this chain declared no window" arm. The field is
   live the moment a human edits the declaration; until then the forward is
   pinned by tests and exercised by nothing. That edit is the follow-up.

2. **`docs/CHAIN-AUTHORING.md` lists `agents` bare.** In the declaration
   field listing (*Optional:* …, around line 138) every other optional field
   carries a parenthetical naming what it decides; `agents` alone is a bare
   name, so the four subfields — `model`, `extraArgs`, `contextWindow`,
   `inheritUserMcp` — are documented nowhere a package consumer reads before
   the hover text. That page states what a shipped interface does, so it is
   pinnable surface (`engineering.md`, *Narration is the ladder's bottom
   rung*). Not filed here: out of this entry's scope, and a doc gate would
   want the list derived from the schema rather than a fifth hand-kept copy.
