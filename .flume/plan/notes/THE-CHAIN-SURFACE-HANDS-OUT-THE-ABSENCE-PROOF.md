# Handing an fs symbol out tripped the scan's uncalled verdict

Putting `isDirectoryOrAbsent` on `FlumeApi` reds
`tests/namespacedFsPaths.test.ts` — "every fs symbol src/ imports is
called": `src/flumeApi.ts` imports the probe and only hands it out, so the
scan reported an import it could not judge.

Respelled at the contract rather than excepted: an uncalled import is a
finding only where `PathContract.calleeFolds` is false. The probe namespaces
every step of its own descent, so no call site anywhere owes a fold and
handing the binding out lets nothing past; an uncalled `readFileSync` still
reds. Both arms pinned over one fixture
(`tests/namespacedFsPaths.test.ts`, "the scan's reading of an fs symbol
handed out rather than called").

Debt observed, not filed: `statLoud` / `existsLoud` carry the caller-folds
contract, so if a later entry wants either on `FlumeApi` the uncalled
verdict reds again — correctly, since a chain would then owe a fold no
scanned module makes, and `namespacedJoin` is on no chain surface. That is
the fork plan would have to settle first: either the api hands out a
folding face, or those two stay engine-internal.

Also observed: the cascade example's inbox leg now refuses an obstructed
inbox by throwing out of `shouldRun`. The engine surfaces that as a tick
failure; no chain-side arm reads it as "queue unreadable" specifically.
Loud, so within the posture — but if plan wants an operator-facing verdict
rather than a stack trace, that is an engine reporting question, not the
example's.
