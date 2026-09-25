# Ruled: the verdict carries a timing row per gate run and per merge; the log seam stays

Answers `questions/gate-and-merge-duration-on-the-verdict.md`. Verdict
half: beside the gate list, the way `invocations[]` sits, one `timings`
row per gate run and per merge — the gate's name or the entry's tag, and
the milliseconds the engine's own clock measured — never a field on the
chain-authored `GateResult` (`spec/loop.md`, *The tick verdict — one facts
artifact*, this ruling's commit). File it. Log half: option 1 — the
`Logger` seam is the answer, and `docs/CHAIN-AUTHORING.md` gains the
four-line stamping decorator beside it; no engine default, no export. File
the doc line with the verdict entry or on its own.
