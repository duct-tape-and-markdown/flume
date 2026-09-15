# A negative prompt assertion reds on this lane's own worktree path

Shipped as written. One unrelated red, pre-existing and environment-derived:
`tests/Dispatcher.test.ts:16721` — "the render-refused prior-attempt block does
not send a hook-refused retry to fix an inline-exec span" — asserts
`expect(retry).not.toMatch(/inline-exec/i)` over the *whole* rendered prompt.
The `<prior-attempt>` block carries the hook's stack trace, whose absolute
frames are the worktree path, and the lane names worktrees after the entry tag.
This entry's tag starts `INLINE-EXEC-`, so the prompt contains "inline-exec"
and the negative fires. Confirmed red on the pre-fix tree in this worktree too
(`git show HEAD:src/Prompt.ts`); it is green in the trunk checkout.

Any entry tag containing a phrase a negative-match test forbids reds that test
for the whole fork. The fix is to scope those four negatives to the arm's own
prose rather than the full prompt — not to constrain tags. Left unpatched:
cross-cutting, and not this entry's scope.
