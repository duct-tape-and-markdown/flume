# A split strands `{@link}` references, not just path pairs

The move landed as planned: all six names now stand in `src/agentSpend.ts`,
the four readers import from there, and `readAllInvocationRows` type-imports
`PhaseInvocations` back (a type-only cycle, erased at compile).

Observed, and worth a phrase: `engineering.md`, *A module is one job* names
the citation a split strands as "a comment naming the old file" — the
`` `name` (`path`) `` pair. That is not the only class. Two moved doc
comments carried `{@link TickVerdict}`, which resolves from the citing
module's imports; once the comment left `tickVerdict.ts`, both reds appeared
in `tests/commentCitations.test.ts` — the pin caught them, so nothing shipped
green at the wrong door. I re-homed each as `` `TickVerdict`
(`src/tickVerdict.ts`) `` rather than widening the type import, since a type
imported only for a `{@link}` is an import no value reads.

So the split-re-homing obligation has two instruments behind it, not one, and
the prose names only the weaker. No entry filed — the pin already enforces
what the prose under-describes, which is the ladder working.

Second observation, no action taken: the tree is not prettier-clean at HEAD.
`src/loopSupervisor.ts:219`, `src/cliVerdict.ts:375` and
`tests/cliVerdict.test.ts:525` diverge from `npx prettier` output on this
tree, untouched by this entry, and no gate reads formatting. Either the
formatter is not the repo's standard or the check is missing — plan's call.
