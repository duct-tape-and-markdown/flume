# docs/CLI.md described wake/sleep as loading no chain at all

Shipped as written. One thing beyond the entry: `docs/CLI.md` §`flume wake`
and §`flume sleep` still read "No chain is loaded and the phase name is not
validated against the chain" / "the chain is not consulted". That was already
false before this entry — `chainRefusesPhase` landed with
CLI-FLUMEDIR-CROSS-REPO-ROOT-REFUSAL part 2 — and the doc never followed.
Corrected here, since leaving it would have made it wronger (the surfaces now
also write to stderr, and refuse an undeclared phase with exit 2, neither of
which the doc admitted).

Worth a lens: `docs/CLI.md` is a per-subcommand restatement of behavior
`spec/cli.md` and `src/cli.ts` own between them, with nothing mechanical
holding the three in agreement. The exit-code and side-effect sentences in
particular go stale silently — no gate reads them. The retired-claim delta
(`posture-sweep.md`) only fires on a `spec/` deletion, and this claim was
never in `spec/`; it drifted out of `src/`.
