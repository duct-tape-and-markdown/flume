# A gate fixed mid-run still judges in-flight ticks; the quarantines it causes outlive the fix

Downstream field report, 0.19. Gate scripts are read from each worktree at
its base, so a gate fixed on trunk mid-run judged in-flight ticks with the
old version — four reverts, then run-scoped quarantines that took a restart
to lift. Asked: document that gates change between runs; a verb to lift a
quarantine; key the quarantine on the gate version.

Ruled: a gate-stage quarantine lifts when the tip has moved past the tick
that placed it, since the world it judged is gone; a provision-stage one
stays run-scoped (`spec/loop.md`, *Repeated identical failures*, this
ruling's commit). The consecutive-identical-failure abort remains the
backstop. No lift verb: the quarantine is the run's memory, and a stop and
relaunch is its operator door. The per-worktree gate read is documented
where chain resolution per tick is stated. File the quarantine change and
the doc line.
