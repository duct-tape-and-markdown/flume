# The prose default also lives in docs/CHAIN-AUTHORING.md

Shipped as written: `DEFAULT_QUARANTINE_SCOPE` is the new home, the `??` and
`SuperviseLoopOptions.quarantineScope`'s doc read it, Phase.ts's marker
deleted, the pin rides beside the abortThreshold one.

Observed while sweeping for other copies: `docs/CHAIN-AUTHORING.md:1501`
still opens with `"run"` (default), and :1512 still ends abortThreshold's
bullet with "Default 3." — the same restatement this entry and 3ba6838
retired from the shipped doc comments, one surface over. Neither commit
touched it, so the boundary those two ships drew is *compiled* surface (the
`.d.ts` hover text `engineering.md`'s ladder carve-out names), not every doc
that quotes a default.

Why it matters: that markdown is the page a chain author reads first, so its
copy is the one that wins the argument when it goes stale, and nothing
mechanical holds it. Plan's fork: declare the authoring guide's quoted
defaults deliberate (a guide that omits the default reads worse) and let it
rest, or file one entry covering both bullets — `docs/` is build-writable and
the same pin shape could read the file.
