# The drain edits records and entries a build tick is carrying; the gate refuses the whole commit

Downstream field report, 0.19, `maxTicks: 3`, wide waves. Two shapes of one
cause. (3) Plan deleted a park note while a build tick re-wrote it; the
modify/delete conflict failed the merge and quarantined the entry, though
the build's only change was that note. (4) The inbox drain folded build
notes into entries build was still carrying; `pendingGate`'s claim check
refused the entire plan commit, four times in three runs, with the queue
listing marking the claimed entries and a PROTOCOL line telling plan to
leave them alone. Prose did not bind, here as in this repo.

Ruled: a claim covers the entry's records too, and the window withholds
them. The inbox window renders no note, park, or record whose entry is
claimed — they are deferred on disk to a later drain — and the claim check
reads a claimed entry's note files as it reads its ledger file
(`spec/pending.md`, *Claims — an entry in flight is left alone*, this
ruling's commit). Mechanism where the prompt line failed. File it.
