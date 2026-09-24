# Ruled: an unknown phase is a usage refusal, exit 2, at every verb

Answers `questions/an-unknown-phase-exits-1-at-tick-and-2-at-every-other-verb.md`.
`spec/cli.md` keeps the usage class whole; `spec/loop.md`, *Baton* now says
exit 2 (this ruling's commit). The supervisor never spawns a child for a phase
the chain does not declare — it reports the orphaned baton itself — so the
code is argv's alone, and one refusal has one code. Derive the one-site change.
