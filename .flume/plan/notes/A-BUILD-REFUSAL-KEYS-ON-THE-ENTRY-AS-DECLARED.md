# The declaration key needed a home of its own

`quarantineKey` lived in `src/selection.ts`, which imports `entryAttemptKey`
from `src/priorAttempts.ts`. Stamping the key onto the record meant
priorAttempts importing selection — a cycle. Moved the derivation to
`src/entryKey.ts` as `entryDeclaredKey` (`engineering.md`, *A module is one
job*): two readers now, the quarantine hold and the record's stamp, and
neither owns it. The `StageFailureEntry.quarantineKey` *field* keeps its name;
it is the `FLUME_QUARANTINED_SLUGS` channel's value.

Debt observed, not filed: `Omit<X, "headSha" | "at" | "key" | "keyedAs" |
"declaredAs">` is now spelled **twelve** times in `src/priorAttempts.ts` — six
in `PriorAttemptDraft`, six more as each `build*` return type. A shared
`type Stamped = …` alias is the obvious fix and I did not take it: it would be
a new exported name (declaration emit reaches it through exported signatures)
with no cross-module consumer, which is what `engineering.md`, *An export earns
its consumer* reds. If plan wants it, the shape that works is folding the six
builders' return types into `PriorAttemptDraft` arms — but check first whether
any callsite reads a mode-specific field off a builder's result.

Also observed: two singleton/fanout **byte-identical record** agreement pins in
`tests/Dispatcher.test.ts` (tip-moved, render-refused) now normalize a third
field out. Their normalizer has grown a line per keyspace-scoped field
(`key`, `keyedAs`, now `declaredAs`); the next such field makes the pin mostly
normalization. The claim worth keeping is "the shared persist path writes one
shape", which a per-keyspace expected key-set would state directly.
