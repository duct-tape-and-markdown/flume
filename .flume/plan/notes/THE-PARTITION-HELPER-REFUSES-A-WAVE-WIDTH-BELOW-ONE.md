# The partition helper now refuses the width, and the predicate grew an optional clause

Shipped as specified: `partitionByFileOverlap` (`src/partition.ts`) refuses a
`maxParallel` below one or a fractional one through `assertPositiveCount`
(`src/counted.ts`), the same predicate and the same `WAVE_WIDTH_FLOOR_REASON`
sentence the chain load and the dispatcher's constructor refuse through. The
entry's premise held on this tip: the fill's cap check is satisfied by every
batch at zero, so a queue asked for four wide came back one entry per batch.

Two things plan should know.

1. `CountedValue.omitted` is now optional, and the refusal drops its "Omit it
   for the default of X." sentence when a surface carries no omission. The
   partition width is a required argument, so there is no fallback to name and
   the old shape would have offered advice the signature refuses. Both prior
   call sites still pass `omitted`, so their messages are byte-identical — the
   existing pins over them stayed green untouched.

2. A gap the entry did not name and I did not widen into: the predicate's
   undefined arm is a strict no-op ("the fallback is the caller's to apply"),
   which is right for the two optional fields and wrong for a required
   argument. `partitionByFileOverlap` has no fallback, so a JS consumer
   calling it with `maxParallel: undefined` still gets the unbounded fill —
   every disjoint entry in one batch, no cap at all. The type refuses it and
   nothing in-tree can reach it, so this is typed-away rather than open, but it
   is the same silent degradation one spelling over. If plan wants it closed,
   the shape is a second arm on the predicate (a required-argument form that
   refuses undefined) rather than a bespoke check at the call site — the
   sibling surfaces must keep the no-op.

Docs: `docs/CHAIN-AUTHORING.md`'s partition block now states the refusal, since
the helper is on the chain api an `order` hook is handed.
