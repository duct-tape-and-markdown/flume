# The interface hint renders last, a block away from acceptance

Declared last in `packageFields` (`harness/entryExtension.ts`), following the
order `spec/harness.md`, *The entry extension* lists it in — so the rendered
schema a plan tick reads puts `interface` after `contractTouching`, while the
field it pairs with, `acceptance`, is third. Build reads the two together (the
new bullet in `harness/prompts/build.md` says so); plan reads them a block
apart. If that listing order is a statement, nothing to do. If it is an
accident of the sentence being appended, the fix is in the spec sentence, not
in the module: the declaration follows the section, and swapping it here alone
would put the module and the section out of step.

No paragraph was added to `plan-derive.md`. The hint is the field's one home,
and a prompt paragraph restating it is the drift `entryExtension.ts`'s header
fences; the field's rule reaches plan through the rendered schema like every
other field's.

The schema rules on completeness alone — a strict object of three non-empty
strings, so two parts, four parts, or a blank part are each refused naming the
part. Whether an entry needs one stays plan's judgment and nothing downstream
can re-decide it: an entry that changes a caller's view and declares no
interface is indistinguishable, at build, from one that legitimately changes
none. If that judgment turns out to be missed often, the lever is the derive
prompt's own discipline, not a gate.
