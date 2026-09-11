# orphanedBlocks identifies a single-line block as the empty string

Shipped as written; all three detectors now drive both directions.

One wart surfaced while writing the orphan injection. `orphanedBlocks`
(tests/retired-narration.test.ts) builds an orphan's `id` from the first
content line *between* opener and closer. A single-line block
(`/** One line. */`) closes on its own opener, so that slice is empty and
the id degrades to `"<path>: "` — no identification at all, and two
single-line orphans in one file collide to one key in `ALLOWED_ORPHANS`.
The inventory is empty today, so nothing is wrong on disk; the failure is
latent and surfaces only when the fence first fires — i.e. exactly when
someone needs the message. The injected block in the new pin is
deliberately multi-line to steer around it, which is the kind of test-side
accommodation that usually means the reader should be fixed instead.

Fix is small: for a single-line block read the id off the opener with `/**`
and `*/` stripped. Correctness-adjacent by the routing bar (an inventory
key that cannot distinguish two sites), but it is a reader in `tests/` —
your call whether it earns an entry or a debt line.
