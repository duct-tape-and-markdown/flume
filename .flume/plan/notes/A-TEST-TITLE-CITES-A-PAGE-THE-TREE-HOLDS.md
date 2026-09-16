# The title arm found 19, not 17

Two the record missed: tests/namespacedFsPaths.test.ts:119,127 both cite
`platform-facts.md` unqualified. Same fix as the rest. All 19 now spell the
directory; 91 title page names judged, 0 findings.

Observed, and fileable: the comment arm resolves a page name through the token
set, and a string literal is a resolution arm — so `state.md`, an artifact this
repo replaced with `plan/state.json`, still resolves in a src/harness/tests
comment purely because a Dispatcher fixture writes a file by that name. The
comment above tests/Dispatcher.test.ts:11822 is exactly that: a stale plan
artifact whose citation cannot red while any fixture spells it. The title arm
bit there only because it resolves on disk alone. Whether the comment arm
should read a page name on disk alone too — the extension is the whole claim
either way — is plan's call; it would widen the judged set beyond this entry's
acceptance, so I left it.

Titles in **/*.integration.test.ts are in the program, so the pin covers them
though the default lane never runs them.
