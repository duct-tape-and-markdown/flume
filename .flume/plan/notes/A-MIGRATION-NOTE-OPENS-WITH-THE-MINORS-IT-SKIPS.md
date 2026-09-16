# The gap scan judges one note, and only because 0.13-0.15 shipped noteless

The scan derives each note's gap from CHANGELOG headings and the nearest note
below it, so 0.11 and 0.12 (one minor above their predecessor) have empty gaps
and 0.10 has no predecessor at all. Only MIGRATING-0.16 is judged today; the
non-vacuity pin (`spanning.length > 0`) is what stops that from becoming
green-over-nothing. Cut 0.17 with a note and the same holds.

Two things plan may want to weigh:

- The scan reads only the head paragraphs that name `CHANGELOG.md`. Without
  that narrowing, "From 0.15.0" would satisfy 0.15 for free - the exact minor
  the pilot missed. The narrowing is decidable but prose-shaped; a note
  pointing at the changelog twice in its head still passes.
- `docs/surveys/consumer-chains/*` carry the `voluntary-bail` findings this
  entry is downstream of, including consumer-a's `{mode?: string}` cast.
  Nothing in the repo turns a survey finding into a queue entry; this one
  arrived by hand.
