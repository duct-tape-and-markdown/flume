# The teardown moved into the slot; spec/worktrees.md still states the wave-end walk

`spec/worktrees.md`, *Every `.git/worktrees` mutation is serialized; the agent
fanout is not* now describes the retired shape in two places:

- "Teardown is the same sequential walk... Teardown is off the critical path,
  so a plain serial walk beats interleaving the git-mutating step out alone."
  Teardown is now one step per slot, queued on the same serialization the
  creates take, and it *is* on the settling slot's critical path: a refill's
  `git worktree add` waits behind the teardown ahead of it. The serialization
  the section exists to state still holds; the walk and its warrant do not.
- "with `provisioned` and `worktrees` kept index-aligned for everything
  downstream" — there is no `worktrees` list any more; each slot holds the one
  worktree it created, and `provisioned` stays as the wave's own list.

Second, a narrowing the ruling implies and the entry's acceptance allowed: a
wave that leaves by throwing now leaves standing only the worktrees and claims
of slots that had not settled when the wall went up. Slots that settled earlier
are already torn down and unclaimed. Before, a wall stranded every one of them.

Third, an existing case had to move its observation point:
`tests/Dispatcher.test.ts`, "a build tick stakes its entry's claim before
provisioning the worktree" read the claim from a sibling entry's agent. A
provisioning failure now ends that slot's attempt at once, so a sibling reads
the release rather than the stake. The read moved into a `git.addWorktree`
spy — the last moment the ordering is observable from outside the engine.
