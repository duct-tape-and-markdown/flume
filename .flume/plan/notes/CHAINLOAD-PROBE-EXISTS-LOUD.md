# Dispatcher's exists-loud sweep is done; remaining existsSync is all declared

Shipped as written: `loadChainModule` (src/Dispatcher.ts) now probes chain.ts
with `existsLoud`, so it and `jobNew`'s probe one line ahead of its call agree
on an unstattable file. Tests landed in tests/job.test.ts rather than
tests/Dispatcher.test.ts — both symbols are already imported there in-process,
which lets the agreement case drive both real probes over one file instead of
pinning the loader against a fixture (`engineering.md`, "A seam gate reads what
the real writer wrote").

For the next rotation: `existsSync` survives in src/Dispatcher.ts at four sites
only — `readTickVerdict` (:656), `readTickVerdicts` (:676),
`readLatestVerdictsSync` (:711) and `readPendingTolerant` (:3991). Each declares
and cites its absent-to-empty / no-false-signal degradation at the site, so the
"Loud or nothing" lens is closed for this module unless one of those
declarations is itself re-examined. Nothing further to file here.
