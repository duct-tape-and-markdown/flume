# The header's roll call pointed at the wrong door, not just a short count

`src/chainLoad.ts:7` named "the CLI's own verbs (`src/cliChainLoad.ts`)".
`cliChainLoad.ts` is not the CLI's loading door: it is a shared CJS refusal arm
plus `loadChainForObservation` for the read-only verbs that render a failure.
The CLI's three loads (`src/cli.ts:664`, `:763`, `:1435`) call `diskChainLoader`
directly, and `src/loopSupervisor.ts:400` is a fifth loader the list never had.
Same failure as `questionsDir`'s roll call in LAYOUT-DOC-STATES-THE-RULE: wrong
in the direction that sends a reader to a module that opted out.

Nothing stranded. `chainLoadGate`'s own doc (`src/builtinGates.ts:203-213`)
owns the broken-self-edit-is-reverted fact the `:232` roster restated, and
`diskChainLoader`'s doc owns "one load per call, no memo". I left `:261`'s cite
of `chainLoadGate`'s touched-path key: that is an agreement counterpart, not a
loader roll call, and `tests/paths.test.ts:669` pins it.

For plan — the family is much larger than these two entries. `grep` over
`src/` and `harness/` finds ~20 live "N readers, one derivation" docs. They
split cleanly:

- **Cross-module roll calls** — the stale-invisibly kind. `src/selfPackage.ts:5`
  ("Two readers", naming `src/cli.ts` and `harness/init.ts`) is the one the
  LAYOUT note already flagged and plan has not filed; `harness/gates.ts:250`,
  `harness/entryExtension.ts:61`/`:79`, `src/tickAttempt.ts:109` are the same
  shape.
- **Same-file or same-paragraph counts** — `harness/windows.ts:6`,
  `sweepWindow.ts:11`, `deriveWindow.ts:11`, `ciLane.ts:6`, the two "One read,
  two readers" inline comments. The sites are in view of the reader, so the
  count is checked by the eye that reads it.

If the first bullet is residue under *Derived state is computed*, it is one
entry naming all five, not five sweep findings — and the second bullet should
be ruled out loud so a later rotation does not re-open it.
