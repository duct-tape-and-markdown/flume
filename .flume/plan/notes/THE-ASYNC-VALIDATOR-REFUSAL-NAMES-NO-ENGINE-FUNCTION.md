# A refusal string is outside every resolution arm

Shipped: the async-validator refusal now says "the queue parser", and a new
top-level test in `tests/PendingSchema.test.ts` extracts the camelCase spans
from the message and refuses any that `src/` declares. The doc comment above
`AsyncEntryExtensionValidatorError` keeps `parsePendingQueue`, where the
citation pin does resolve it.

Observed, for plan to weigh — do not read this as a filed finding:

1. `docs/CHAIN-AUTHORING.md` (~line 2218) states the same rule in prose and
   names `parsePendingQueue` backticked. That one resolves against the
   package's exports under the docs arm, so it was left standing.

2. I scanned every `src/` string literal for camelCase spans that `src/`
   declares, to see whether this entry's class recurs. 331 hits, almost all
   legitimate: declared chain surface the message is *about*
   (`Chain.supervisorPolicy.maxParallel`, `DispatcherOptions.stopSignal`),
   option keys, and interpolation fragments my crude regex read as string
   text. A sweep lens over "engine symbol inside a runtime string" would
   need to separate an engine-internal function name from the declared
   surface a refusal is entitled to name, and I did not find a mechanical
   line between them. Filed here rather than as a lens so plan can decide
   whether the class is worth a narrower predicate (e.g. only names absent
   from `src/index.ts`) or is a one-off.

3. The detector in the test is local to that file. If the class does earn a
   lens, the extractor belongs in `tests/helpers/`, beside the citation
   scan — it is the same "read the token, never its meaning" mechanic
   pointed at string literals instead of comments.
