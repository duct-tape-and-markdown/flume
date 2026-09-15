# render shipped; three calls the section did not make

spec/cli.md §Subcommand surface rules the verb but is silent on three
things I decided at the site. Each is cheap to flip.

1. **Fanout with no `--entry`.** Ruled: the dispatcher's own batch
   arithmetic picks — `pickableEntries` → `partitionByFileOverlap` →
   batch[0][0], the entry the next wave carries first. Alternatives
   were requiring `--entry` under fanout, or rendering the whole batch.
   Nothing pickable and no `--entry` refuses exit 2.

2. **`render` reads the queue at HEAD; `check` reads the working tree.**
   That is `Dispatcher.readPending`, so it is the tick's own read and
   correct by "nothing is re-derived" — but the two spend-no-agent verbs
   now disagree over an uncommitted `pending.json`, and nothing says so
   except the prose I wrote.

3. **Stream split.** stdout = the omission notice line + the prompt;
   stderr = which entry was selected and whether a tick would carry it.
   The section only fixes the first line of stdout.

`--entry` scopes to any queue entry, pickable or not — a parked entry
renders, with stderr saying a tick would skip it.
