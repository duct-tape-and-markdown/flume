# Ruled: the reference consumer declares its friction channel

Closes `plan/questions/this-repo-declares-no-friction-channel.md`
(cd3372da). Option (a): `.flume/declaration.ts` declares
`friction: "friction"` under the state root, gitignored by the engine's own
ignore machinery. The loop now writes revert notes and the teardown harvest
where this repo's own inbox slice reads them, so the leg that shipped at
a0078ac9 runs on its reference consumer rather than on fixtures alone.
The cost named in the question is accepted: revert notes become inbox
traffic a plan tick drains, which is what the channel is for. Nothing
derives beyond what already shipped.
