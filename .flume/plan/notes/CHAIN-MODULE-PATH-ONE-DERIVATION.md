# The two agreement pins read the path out of an error message

`chainModulePath` (src/paths.ts) is now the one derivation; the loader, the
`job new` precondition and `chainLoadGate`'s key all read it, and a third
test holds `"chain.ts"` to one speller across `src/`.

Observed while pinning: neither producer *reports* the path it resolved.
`loadChainModule` and `jobNew`'s precondition state it only inside their
refusal text, so the agreement pins recover it with a regex over that text
(tests/paths.test.ts). Driving the real writer was right — a hand-authored
chain file in the test would re-author the spelling under test — but the
seam is now message-shaped: rewording either refusal reds a green pin, and
no type holds the coupling.

Not filed: nothing behaves wrongly today, and the alternative (the resolved
path on a thrown error's own field) is an API decision, not a mechanical
fix. Plan's call whether that earns an entry.
