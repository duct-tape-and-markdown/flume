# Ruled: the four question files opened at b1be8956

- *A ledger-commit refusal now fail-fasts the loop as mount-dead* — (2)
  with the code **1**: the code is the defect. A non-parse refusal out of
  the ledger commit is a failed tick carrying its verdict, exits 1, and the
  loop proceeds; only the unparseable ledger keeps 69. Build entry.
- *A gate-revert blames the entry for a suite that was already red* — (2):
  on a red suite, re-run only the failing files the entry's footprint does
  not contain, through the existing `runAtBase`. Red there is reported as
  `base-red` on the gate row and the prior-attempt record; the entry still
  reverts (unjudgeable on a red trunk) but is **not quarantined**, so the
  retry is not blamed. No runner interface change. Harness entry.
- *A consumer wants a fence per ticket* — (1): sanction the
  read-a-sidecar-at-load shape in `docs/CHAIN-AUTHORING.md`, naming a
  function-form `fence` over the resolved roots as the surface to file if a
  second consumer needs it. Docs entry; no engine change.
- *posture-sweep.md invites a cite its own resolver refuses* — (1): the
  lenses become bulleted leads under their own heading, *Standing lenses*.
  Rules-page edit, landed in this commit; nothing to queue. The record cap
  is raised to 2,000 bytes in the same landing — the 1,200 was trimming the
  evidence a record exists to carry.
