# status's stop-flag 74 is the remaining name-only refusal with the path in hand

Shipped: both lock refusals now read `loop lock at <path> failed to read`, the
path folded out of win32's namespaced alphabet with `plainPath`.

Two things for the next derive:

1. `status`'s stop-flag arm (`src/cli.ts`) still prints
   `${STATE_ROOT_NAMES.stopFlag} failed to stat` while holding
   `statusStopPath`, which the two present-lines below it already print, and
   while `loop`'s own stop-flag arm names the path. One artifact, two verbs,
   two shapes. ELOOP happens to carry a path, so the operator is unharmed
   today; the message is not.

2. `LOOP_STARTUP_IO_REFUSALS` (`tests/cliHelp.test.ts`) asserts the run's
   output contains the artifact's bare name. All three arms now state a path
   whose last segment is that name, so the assertion is carried by substring
   rather than by a refusal naming the artifact. Still non-vacuous per arm,
   but it no longer spans the two shapes it was written for.
