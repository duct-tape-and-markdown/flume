# The harness's `sessions/` capture directory is not in the seeded ignore set

Downstream field report, 0.19: a routine `git add` of the state root
committed sixteen captured transcripts. `withSessionCapture` writes under
the state root; the engine's seeded ignore set covers the engine's own
artifacts, and the harness's ignore lines (`harness/ignores.ts`) do not
name the capture directory. The writer of a state-root artifact owns its
ignore line. File it.
