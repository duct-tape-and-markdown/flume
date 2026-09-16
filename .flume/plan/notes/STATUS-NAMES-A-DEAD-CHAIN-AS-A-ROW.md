# status keeps its stderr report beside the new stdout row

Judgment call worth a human read: `status` now prints both the row
(`chain: failed to load — <reason>`, stdout, ahead of the count) and the
stderr report it had. I read spec/cli.md's "the count's fall back to the
default queue path is the one cost that report names" as the stderr cost
sentence surviving — the row names the failure, not the cost. If the row was
meant to replace the report on `status`, that is a one-line delete plus the
two stderr arms in tests/cli.test.ts.

The negative arm the entry flagged did not bite: `not.toContain("chain failed
to load")` over status stdout stays green over `chain: failed to load` — the
colon. It would have passed the new behavior silently. Replaced with the cost
sentence as its own arm.

`ChainObservation` (`src/cliChainLoad.ts`) is module-local: exported, the
export-consumer pin reds it, since every caller destructures at the callsite.
