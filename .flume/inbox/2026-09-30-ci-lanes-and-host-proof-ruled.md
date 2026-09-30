# Ruled: CI lanes under load, host-only fixes, and bounded details

- *CI lanes go dark exactly while the loop is productive* — (b): a failed run
  on an ancestor of the tip reads red-standing; its titles stand as findings
  until a later run stops reporting them; it closes nothing and never reads
  green, and closing still needs a run on the tip itself (`spec/harness.md`,
  *CI lanes as a findings source*). No fix attribution by file search — a
  red stands until a later completed run drops the title. A run off a
  non-ancestor commit stays `UNREAD`. Second half, 1 + 2: a host-only defect
  ships its case gated to that host and the lane there is the proof
  (`engineering.md`, *A fix ships the test that would have caught it*); the
  five win32 entries gain `runIf(win32)` cases, not an empty `tests[]`.
- *spec/loop.md calls gate details full above capping it* — "full" struck;
  the bullet says bounded.
