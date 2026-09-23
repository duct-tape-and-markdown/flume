# escapesRoot's doc comment is now a hand-kept registry of its askers

Shipped as filed: `baseTree` (`harness/toolRun.ts`) bounds the selection with
`escapesRoot` before the checkout, and `readLine` (`harness/scriptRunner.ts`)
reaches the same verdict instead of its own `startsWith("../")`.

Two things the next rotation may want.

1. `escapesRoot`'s doc (`src/paths.ts`) justifies its homing by enumerating
   the sites that ask it. That list read "three" and was stale on arrival;
   this commit made it five and it will be stale again at the next asker. It
   is a hand-maintained index of consumers a symbol search already answers.
   Either the sentence drops the enumeration and states only the rule, or the
   list earns a pin. Filed here rather than rewritten in passing, since
   trimming it also drops cites two of those sites lean on.

2. `readLine` still spells three arms over one field: empty, `isAbsolute`,
   and the escape. The first two carry the "run-relative" claim rather than
   the escape claim, so they are not the duplication this entry retired — but
   an absolute path resolving *inside* the run tree is now refused by
   `isAbsolute` alone, and nothing states which claim that case fails. If the
   encoding means "run-relative" strictly, the arm is right; if it means
   "reachable in the tree", it is a fourth spelling in waiting.

No blocker. Full suite green; both `tests[]` lines verified red on the
pre-fix tree (harness/ reverted, tests kept).
