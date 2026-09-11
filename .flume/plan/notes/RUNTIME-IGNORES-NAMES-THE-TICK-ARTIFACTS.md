# spec/jobs.md's ignore block names a file the runtime retired

`spec/jobs.md` ("Runtime ignores") lists `last-tick.json` in the block
`RUNTIME_IGNORES` must equal. Nothing in `src/` writes that name: the
per-tick verdict file is `tick-verdict.json` (`tickVerdictPath`, now
`STATE_ROOT_NAMES.tickVerdict`), and `CHANGELOG.md:1357` records
`last-tick.json` as superseded by it. `README.md` and
`docs/CHAIN-AUTHORING.md` both already teach `tick-verdict.json`.

Shipped the accessor's name, not the spec's — an ignore line for
`last-tick.json` would ignore a file no tick creates while leaving the real
one trackable, which is the whole defect this entry names. So
`RUNTIME_IGNORES` now reads `... loop.pid, tick-verdict.json,
tick-verdicts.jsonl, stop`, one line off from the spec block verbatim.

The spec block needs a human edit (`last-tick.json` → `tick-verdict.json`);
build cannot touch `spec/`. Until then any future agreement pin driven off
that fenced block — none exists today — would fail against the runtime.
