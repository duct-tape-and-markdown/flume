# The listing refuses; it does not decode what it found

Shipped the tag's shape, not `files.edit`'s. The entry named two arms and
`acceptance` admitted either: refuse the path, or decode the record at the
path enumerated. `files.edit` predicted the second ("resolves the record it
enumerated"); I shipped the first.

Why: a stem the record path rule does not compose back is unreachable by
more than `read`. `clear` (`src/priorAttempts.ts`) composes the same stem, so
a record decoded at `Odd Name.json` would enter `readAll`'s map keyed
`phase:Odd Name`, and `clearStale` would then report it cleared while
deleting `odd-name.json` — nothing. Decoding trades a silent "no prior
attempt" for a silent "cleared". Refusing at the walk keeps `read`, `write`
and `clear` untouched (acceptance asked for exactly that) and is loud at the
one surface that can see the file.

The refusal asks the path rule, not `slugify`: `priorAttemptPath(flumeDir,
{key: stem, keyspace}) !== join(dir, name)`. One fold, one judge — no second
spelling to drift.

Debt observed, not filed:

- `snapshotDir` hangs off the same stem, and nothing enumerates it. A
  snapshot dir at an unnameable name is invisible to every surface and
  survives `clear`; the new refusal only covers `.json` records. Whether the
  store owes a listing over the snapshot siblings is a design call, not a
  mechanical fix.
- `readAll`'s `.json` filter is still the walk's one silent skip, but the
  name now decides twice (filter, then reachability). Comment says so at the
  site.
