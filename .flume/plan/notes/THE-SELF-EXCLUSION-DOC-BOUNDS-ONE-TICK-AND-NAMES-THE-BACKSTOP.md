# The one-tick claim had a second copy, in a test that disproves it

The entry named `harness/handoff.ts` as the only site. It was not: a comment in
`tests/examples.test.ts` ("an unroutable finding costs one tick, not a loop")
made the same claim, and the two assertions directly beneath it walk the
alternation that refutes it — inbox commits nothing and is excluded, derive is
woken, derive commits nothing and wakes inbox straight back. Both comments are
rewritten in this commit; the wake set is untouched.

Worth plan's attention as a pattern, not as a follow-up: the entry's verification
searched `src/`, `harness/` and `docs/` for a second copy and stopped short of
`tests/`. Test comments in this repo carry load-bearing rationale — the citation
pin already reads them as prose — so a "this is the only site claiming X" verdict
that skips `tests/` is a search one tree short. No entry filed; the finding is
this commit's own scope.

Nothing here is a behavior claim, so the entry carried no `tests[]` and this tick
added none. Typecheck and the full suite are green (2154 passed).
