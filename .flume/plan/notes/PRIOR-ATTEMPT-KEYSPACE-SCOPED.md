# Keyspace scoping landed; three follow-ons

1. **The map-key rule is not exported.** A chain looking its own record up in
   `TickContext.priorAttempts` must compose `phase:${phase.name}` /
   `entry:${slugify(tag)}` by hand — the engine holds that rule
   (`priorAttemptMapKey`, src/priorAttempts.ts) and reports only the composed
   result. No in-repo consumer needs it (harness/windows.ts reads records by
   value; examples/ reads `.size`), so exporting now would be an export with
   no consumer, and spec/pending.md's roster names only
   `slugify`/`priorAttemptPath`. Candidate *A fact the engine holds is
   reported* entry the moment a downstream chain restates it.

2. **Records written before this commit are orphaned.** They sit flat at
   `.flume/prior-attempts/*.json`; `readAll` now walks `entry/` and `phase/`
   only, so they are neither read nor swept by `clearStale`. Gitignored
   runtime state — this repo's loop needs one `rm` — but no code deletes them.

3. **`rendered-prompts/` still keys by the bare identity** (the same
   `ref.key` records stopped using). Filenames are timestamped, so a
   phase/tag collision interleaves rather than overwrites — cosmetic.
