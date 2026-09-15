# The measure the entry wanted cited has no package-side home

The entry asked `harness/prompts/build.md` to state the measure "per
`.flume/PROTOCOL.md`, *A record is short*". It cannot: `{{DISCIPLINE}}`
resolves to `harness/prompts/plan-discipline.md` (`sharedPromptArgs`,
`harness/prompts.ts:191`), and the package has no token for a consumer's
PROTOCOL. So build.md states the measure inline -- bytes not characters,
`wc -c`, an em-dash is three -- and this repo's PROTOCOL states it again at
line 80.

Two copies of one instruction, and the package cannot delete either: the
prompt ships to every consumer, PROTOCOL is this repo's. If a third
consumer restates it, that is the package missing a slot, not three chains
being sloppy -- a declared `records` slot, or the cap's own prose reaching
the prompt beside `RECORD_MAX_BYTES`. Filing it now would be premature; one
more restatement makes it an entry.

Also touched, in scope: `harness/templates/PROTOCOL.md:58` said the cap was
the package's without saying who enforces it, which read as gate-enforced
after this change. It now names the drain.
