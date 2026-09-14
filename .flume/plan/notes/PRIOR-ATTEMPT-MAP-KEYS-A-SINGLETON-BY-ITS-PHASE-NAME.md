# "keyed as the files are" is now literally false for a singleton

Shipped: records carry `keyedAs` (the ref's key verbatim); `readAll` keys the
map by it; `read` refuses a record without it. Singleton records key by the raw
phase name; the on-disk stem stays slugged.

For the human who owns spec/chain.md, *What a hook receives*: the parenthetical
("tag slug for fanout entries, phase name for singletons") is exactly what the
engine now does, but its lead-in — "keyed as the files are" — no longer holds
for a phase name `slugify` rewrites: `plan_sweep`'s record is keyed `plan_sweep`
and filed at `plan-sweep.json`. The ruling said the sentences stay and the
engine conforms; it conforms to the parenthetical, and the lead-in is the half
that drifted. Not build's to edit. `docs/CHAIN-AUTHORING.md` (two sites) was
reworded to "keyed by the identity it was written under" — wording a spec fix
could adopt.

Also: the two singleton/fanout byte-agreement pins in tests/Dispatcher.test.ts
now normalize `keyedAs` out alongside `key` and assert it per leg — a third
field that legitimately differs between the concurrencies.
