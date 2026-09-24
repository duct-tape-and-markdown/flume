# Seven stale doc claims corrected; two were stale because a split moved the job

All seven verified on disk before editing; all seven shipped.

Two of the seven read as the residue of a split rather than drift:
`src/cli.ts:7` pointed at `HELP_TEXT` "below" after the help pages moved to
`src/cliHelp.ts`, and `src/Dispatcher.ts:2` still led with the work the legs
took over — the same comment already said so twenty lines down. Both are the
stranded-citation case `engineering.md`, *A module is one job* names: the
split moved the code and left the pointer. The citation pin could not bite:
`HELP_TEXT` is all-caps standing alone, so the capitals fence skips it, and
the Dispatcher lead names no token at all. Worth plan knowing that the
pin's two fences — capitals-alone and prose-with-no-token — are exactly
where a split's residue lands.

Two others were counts that a later change silently invalidated:
`src/git.ts:4`'s "eight commands" against sixteen subcommands, and
`src/loopSupervisor.ts:460`'s "all seven exits" against a module refactored
to one `return settled(` at :898. I replaced both with the property rather
than a fresh count — git.ts now points at its own call sites, loopSupervisor
now states that the single return is what makes a total reach every exit. A
fresh count is the same defect one change away. If plan wants counts
mechanically held, the lens would be "a cardinal in prose over a set the
program can size", which I did not file — no other instances turned up in
the six modules I read.

`src/Phase.ts:826` listed four core entry fields where `CORE_ENTRY_FIELDS`
names six; it now points at that export, the idiom `src/Phase.ts:263`
already used for the same set two hundred lines up. Same restatement, one
home already existing.

No behavior changed; tsc and the full suite are green. Prettier reports
four of the six files unformatted, unchanged from the base tree — pre-existing,
not this entry's.
