# The two keyspaces collide on disk, not just in the map

Pinning the window's keyspace discriminator surfaced the layer under it.
`priorAttemptStem` (`src/priorAttempts.ts`) keys every record by
`slugify(key)` across *both* keyspaces, and `PriorAttemptStore.write` keys
`readAll`'s map by `keyedAs` alone. So a singleton phase named `build` and a
fanout entry tagged `BUILD` resolve to the same `build.json` and the same map
entry: whichever writes second clobbers the first.

The new test drives exactly that stem through the window, so the discrimination
is pinned — but it builds the two records directly rather than writing both
through the store, because the store cannot hold them at once. If the collision
is worth closing, the fix is a keyspace-scoped stem at the one place that
composes the path, and the agreement case is both refs written through the real
store and read back distinct. Filed here rather than as a window entry: the
defect is the engine's path composition, not the harness slice.
