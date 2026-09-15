# The scan's subject rule, and what a raw token scan was hiding

**Four dangling citations, not two.** Beside `hasPickable` and `cherryPick`
(x2), `PriorAttempts.readAll` (Dispatcher.ts:715) named no declaration — the
class is `PriorAttemptStore`. All four repaired.

**Both earlier counts were tokenizer artifacts.** A raw `ts.createScanner`
over file text loses ~half the comments here: `a / b / 2` scans as a regex
literal and swallows what follows. Reading comment ranges off the parse gives
3687 backticked spans, not 1983. The fixture pins that case.

**Declared scope, for a later rotation.** A subject needs an internal capital
(`[a-z0-9][A-Z]`), so `handoff`, `Shipped.limit` and `ENOENT` are never
judged — the camel hump is what separates a reference from a sentence.
Widening to leading-capital segments would pull backticked prose in; that
wants data, not a guess. Current judged set: 1124 of 3687.

**One cited exclusion**: `exactOptionalPropertyTypes`, a tsconfig option. It
reds if the trees stop citing it, so it cannot outlive its subject.
