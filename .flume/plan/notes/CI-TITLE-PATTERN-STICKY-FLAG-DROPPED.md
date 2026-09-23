# everyMatch is the one place a consumer's regex is normalized

Shipped: `everyMatch` (`harness/ci.ts`) now strips `y` along with `g` and
re-adds `g`, so a lane declaring `/^FAIL (.+)$/my` answers the same titles as
the same pattern without `y`. Red on the base at the exact empty set the entry
predicted (`titles: []` against both titles the log stated).

Observed while there: `everyMatch` is the only site in the package that reads
or rewrites a consumer-declared regex, and it now spells its policy as "drop
the flags that carry position, keep the rest". `g` and `y` are the two JS has
today; `d`, `u`, `v`, `i`, `m`, `s` are carried through untouched and none of
them decides how much of the log is read. So the fix generalizes as written,
with no per-flag branch to maintain — but the invariant lives only in that one
expression and its header, and if a future flag gains position semantics
nothing mechanical would catch the omission.

Not filed, no entry wanted: the two title-reader shapes diverge in what the
package normalizes — a declared function is handed the shed log and its answer
taken as stated, while a declared pattern is rewritten before use. That
asymmetry is correct (a function carries no stale position) and
`CiTitleReader`'s header states both legs, but a sweep reading only
`everyMatch` could misread it as inconsistency about whose grammar is trusted.
