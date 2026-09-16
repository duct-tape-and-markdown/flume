# 25 of the removed ceilings are unpinned: the arm judges spawning sites only

Removed 255 registrar timeout literals, not 250 — five more were spelled on
their own line, which a line-shaped count misses; an AST pass found them.

The new `sites.ceilings` arm judges 230 of those. The other 25 — all four in
`tests/Gate.test.ts`, six of `tests/harnessRunner.test.ts`'s ten — sit on
registrars that start no process, so the scan never reads them. They are gone
from the tree, and nothing reds if one comes back.

Closing that is a decision, not a fix. The budget's claim is about spawning
sites; widening the judged set to every registrar would put hundreds of
non-spawning cases under a spawn rule. The cheaper shape, if wanted: a
file-level verdict — a file that declares the budget carries no numeric
registrar timeout anywhere — off the same parse.

Integration lane untouched (declares no budget, so a site ceiling sits beside
nothing).
