# The state root's ignore set had a gap the other way too

Driving the derived set against `.gitignore` in both directions turned up
more than the retired `.flume/last-tick.json` the entry named: this repo
never ignored `.flume/stop` either. The stop flag is engine runtime state
(`stopFlagPath`, `src/paths.ts`), so `flume stop` left an untracked file
the clean-tree gate reads as a dirty tree on whatever tick ran next. Added
it in the same commit; the converse test now holds that direction, so a
state-root name the engine adds later fails here rather than surfacing as
a mystery revert.

Second: the derivation reads `RUNTIME_IGNORES` (`src/job.ts`), not
`STATE_ROOT_NAMES` alone as the entry expected. A gitignore line carries
one fact past the name — directory or file, spelled as a trailing
separator — and the engine states it only there. `STATE_ROOT_NAMES` is
still the filter, so the job seed's `node_modules/` drops out and the set
stays engine-owned by construction.
