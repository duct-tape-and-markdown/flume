# Does cascade's build declare a `shipped` predicate, or are its handoff's not-shipped arms teaching-only?

`examples/cascade-chain.ts`'s build handoff now splits `not-shipped` two ways —
a predicate that *returned* false wakes the re-derive, a predicate that *threw*
falls through to the ladder — keyed off `TickResult.shipFailures` by tag
(`:519`-`:525`). The chain it sits in declares no `shipped` predicate at all,
and says so in its own `declaredFilesGate` header (`:252`): "declares no
`entryChannelPaths` and no `shipped` predicate, so every commit it makes
retires the entry."

So `mergeOutcome === "not-shipped"` cannot occur on a real cascade tick, for
either cause. Both arms of that split — the pre-existing declined-park one and
the thrown one — are reachable only through hand-folded `TickResult` fixtures
in `tests/examples.test.ts` (`:1359`, `:1376`), and the "plan ladder over a
real tick" describe beside them cannot reach either: it drives
`cascadeFactory`'s own chain, which has no injection point for a `shipped`.

Two readings, and they want opposite things:

**(a) The arms are teaching surface; nothing to file.** A chain author copies
this handoff and *will* declare `shipped` — that is why the split is spelled
out at length. Defensive-and-correct is the point, the fixture is the only
lens the example's own chain leaves available, and `examples/` exists to ship
opinion by name rather than to be minimal (`engine-boundary.md`, *Opinion
ships by name, opted into*).

- Cost: the split stays unpinned against the real writer, and the sweep's
  **Dead plumbing** lens will re-find it every rotation unless the site
  declares the divergence out loud.

**(b) The arms are dead plumbing, and cascade should carry a `shipped`.** A
predicate makes both arms reachable through `Dispatcher.tick()` and gives the
split the real-writer agreement pin `engineering.md`, *A seam gate reads what
the real writer wrote* asks for — the actual engine writing `shipFailures`,
the actual handoff keying off it.

- Cost: it changes what the shipped example *does*, not just what it shows. A
  `shipped` that ever declines means some cascade commit does not retire its
  entry, and the `:252` header's warrant — "every commit it makes retires the
  entry" — stops being true. Picking the condition it declines on is itself a
  teaching choice, and an artificial one ("decline when the tag ends in X")
  teaches worse than no predicate at all.

**Also on the table, and cheaper than either:** leave the chain alone and
declare the divergence at the site — a line saying these arms are written for
the author who *will* declare `shipped`, so the fixture is the lens on purpose.
That closes the sweep's re-find without touching what the example does, and it
is what `engineering.md` asks of a divergence that is the right depth.

I did not pick: this is a decision about what the shipped example teaches, and
(b) changes the example's behavior to buy a pin.

The engine half is filed regardless and does not wait on this:
THE-SHIP-THREW-RECORD-TAG-NAMES-THE-BLAMED-SPAN pins that the wave's real
throwing hook records a `shipFailures` entry whose `tag` names the blamed span
— the one fact the handoff leans on and nothing currently holds.
