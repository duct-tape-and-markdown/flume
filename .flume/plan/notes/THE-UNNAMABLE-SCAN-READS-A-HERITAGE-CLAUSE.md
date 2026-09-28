# The heritage arm needed a repo pin the entry did not name

The entry's `pins[]` was empty, but `positions.findings` is one array and the
three repo arms each filter it by kind — so a heritage finding would have
landed in no arm at all, and `PriorAttemptEnvelope` could not have been "the
measured red". I added a fourth repo arm, "every type a reached declaration's
heritage clause names is exported from an entry module", mirroring the other
three. It is a pin (green as shipped), not a `tests[]` line; plan may want to
record it as one.

Measured, for the record: 16 heritage positions over `src/` + `harness/`, 6
findings before the fix, all six the same `PriorAttemptEnvelope` base under
the six `PriorAttempt` variants. Nothing else red.

Two smaller observations:

- `positionsOfKind(scan, "heritage")` reports one position per base, so a
  clause naming two bases yields two entries with the same `module:line name`
  — as several call signatures on one container already do. The fixture arm
  asserts the duplicate deliberately.
- A class property the emit writes as `readonly label = "i"` (literal
  initializer preserved, no type node) carries no property position. Same
  shape the `const` case already documents; the fixture's `Implementor` hits
  it, and nothing depends on it.
