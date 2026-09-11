# Both prune call sites now carry the same catch block

Shipped: `runSingleton` accumulates every provision-stage throw (prune,
create, setupWorktree) into one `provisionFailures[]` that rides `result`,
the outcome envelope, and the verdict on every exit — including the exit
where prune throws and `createWorktree` then succeeds.

Observed debt, `engineering.md` *The fix lands at the mechanism*: the
pre-tick prune is now byte-similar at two sites — `src/Dispatcher.ts:1853`
(singleton) and `:2388` (fanout wave). Same try/catch, same
`bound(message.trim(), MAX_FAILURE_SIGNATURE)`, same push, differing only in
the warn line's tail ("worktree creation may still fail" vs "per-entry
provisioning may still fail"). A third caller, or a change to how a
provision signature is derived, has to land twice. Candidate: one private
helper that prunes and returns `ProvisionFailure | undefined`.

Pure shape, not correctness-adjacent — both sides are pinned now
(`Dispatcher singleton — a worktree-prune throw is recorded…`, `Dispatcher
fanout — pre-tick worktree provisioning failure isolates one entry (§16)`),
so accepted-debt line rather than an entry unless a third site appears.
