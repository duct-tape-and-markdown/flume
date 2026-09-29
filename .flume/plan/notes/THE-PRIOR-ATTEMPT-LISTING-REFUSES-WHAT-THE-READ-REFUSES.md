# The listing now selects by name; one silent arm is left below it

Shipped: `readAll` (`src/priorAttempts.ts`) drops `withFileTypes` and filters
on the `.json` suffix alone, so every dirent named like a record reaches
`read` and refuses there. `clearStale` inherits it for free — it walks
`readAll`.

Left standing, same family, not in this entry's scope: the round trip from
dirent name to record path runs the stem back through `slugify`
(`priorAttemptPath` -> `priorAttemptStem`). For every stem this store itself
writes that is idempotent, so the listing lands on the file it enumerated.
For a stem `slugify` rewrites — a hand-placed or foreign `Odd Name.json`
under a keyspace dir — the composed path is a different file, `existsLoud`
answers absent, and `read` returns undefined: a dirent named like a record,
found by the listing, filed as no prior attempt in silence. It is a narrower
hole than the one just closed (nothing the engine writes can reach it), but
it is the same reading: present and unresolved, reported as absent. If plan
wants it closed, the shape is the listing refusing a stem that does not
round-trip rather than composing a path and probing it.

Also noted while measuring: the pre-fix `e.isFile()` test would equally have
dropped a symlink pointing at a perfectly good record. That direction was a
silent omission too, and it is closed by the same change.
