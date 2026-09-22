# The CJS-context refusal matches only the percent-encoded query

Reported by a downstream consumer on win32 (centercode-platform bay,
2026-09-22), flume 0.17.0.

`src/chainLoad.ts:172` keys the CJS-context refusal on
`/%3Fnamespace%3D/i`; the `ERR_MODULE_NOT_FOUND` message on that host
carries the literal `?namespace=`, so `CjsContextLoadError` never fires
and the consumer gets the raw "Cannot find module …?namespace=…" with no
named fix. The one case pinning the arm
(`tests/Dispatcher.test.ts`, "tsx 4.23 signature — … percent-encoded
?namespace= query") plants the encoded spelling alone, so the suite is
green over the miss on every lane (`engineering.md`, *A fix ships the test
that would have caught it*: the repro is the literal form).

Match both spellings — the query as tsx appends it and as node
percent-encodes it — and pin the literal form beside the encoded one. The
comment at `:151` already says the path may arrive percent-encoded, which
reads as "sometimes", so the regex was narrower than its own narration.
