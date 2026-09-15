# Ruled: a red CI lane wakes the inbox slice once per run, stamped in the plan state

Closes the open question *Does a red CI lane open the inbox window, and what
closes it?* Option 2, the recommendation.

`spec/harness.md` *CI lanes as a findings source* now states the liveness
leg: the inbox slice is live for a lane exactly when the lane's latest
completed run for the tip's branch failed and that run is past the stamp the
slice last wrote for it; the slice stamps the run it drained as it stamps a
cursor. A red lane is drained once per run, a green run needs no drain, and
an unreadable lane makes the slice live for nothing. *Plan state as declared
state* names the per-lane drained-run stamp as its fourth field.

Why not the others: render-only leaves a quiet tree hibernating over a red
lane, which `spec/cli.md` rules out in so many words; title extraction puts
a log parser in every consumer's runner and moves *The runner interface* for
a closing condition a stamp closes decidably. The stamp is the shape derive
and sweep already use, and the entry already filed for the reader ships
under it unchanged.

What derive files: the liveness leg on the inbox window and the stamp field
in the plan state, cited into the amended sections.

The question closes; the spec holds the ruling.
