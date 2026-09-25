# The inbox window's last unbounded read is the lane stamp

Landed: the checkout side of the record leg is bounded at one call.
`renderRecordQueues` (`harness/inboxWindow.ts`) refuses in the shared
`REFUSE:` shape over an obstructed record directory, a friction channel that
will not list, and a listed record whose bytes will not come back; the tip
arm and the new ones share one composer (`recordRefusal`).

Warrant corrected in two places: `windowRefusal` (`harness/sliceWindow.ts`)
and its restatement in `inboxWindow.ts` both said the engine invokes
`promptArgs` uncaught. It does not — `resolvePromptArgs`
(`src/tickAttempt.ts`) catches, warns, persists `render-refused`, and the
verdict is written (`spec/chain.md`, *What a hook receives*). The bite, now
stated at the composer: that record's readers are this slice's own next tick,
which throws at the same site. `harness/friction.ts` now names the refusal
that bounds its fail-open leg instead of "fails loudly there".

Still unbounded in this window — read off source this tick, not executed:
`laneLeg(...).render` -> `wokenLanes` (`harness/ciLane.ts:158`) ->
`readPlanState` (`harness/planState.ts:334`), which throws on invalid JSON
and on any non-ENOENT read failure. A corrupt
`.flume/plan/state/plan-inbox.json` therefore throws out of the inbox
window's `promptArgs`: the same circularity this entry closed, one leg over,
and the worse instance, since the only tick that can repair plan state is the
plan tick that dies rendering it. `renderLane`'s declared "unbounded, and
deliberately" covers the forge read alone; the stamp read is not in it. The
cursor windows do not share the hole — `bounded`
(`harness/cursorWindow.ts`) wraps their whole render, plan-state read
included. Lane leg's forge read left as declared.
