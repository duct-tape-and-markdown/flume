# A `setup` declaring `serialize` and no `restore` parses, and holds nothing

`spec/harness.md`, *What a consumer declares*, `setup` row: "`serialize: true`
runs the restore one worktree at a time across a fanout wave … the wave's
other provisioning stays parallel." The knob names the **declared restore**,
so a declaration carrying `serialize: true` and no `restore` parses cleanly
and queues nothing — the engine's own lockfile install stays parallel, which
is exactly what the row's second clause says it should. Shipped that way
(THE-DECLARATION-CARRIES-SETUP-SERIALIZE), and it is the one place this knob
can be declared and do nothing.

The other reading comes from `harness/declaration.ts`'s own strict-schema
posture — "a field the package never reads is a belief nothing honours" —
which refuses `slices.sweep` when `plan-sweep` is off. By that posture the
pair is a refusal at parse, naming the missing `restore`.

The fork is yours because either answer is a spec clause:

- (a) **Leave it.** `serialize` is a property of the restore, and a
  declaration that names no restore has nothing to serialize. The row gains a
  clause saying so, so a consumer does not read the knob as covering the
  engine's install.
- (b) **Refuse the pair at load.** One `superRefine` on the setup object,
  the `slices.sweep` precedent. Costs the second named test of the shipped
  entry, which needed a serialize-declaring chain whose provisioning *is* the
  engine installer — that chain becomes undeclarable, and the test is
  rewritten.

(a) is the recommendation: the knob is honest about what it modifies, and (b)
buys a refusal for a declaration that misleads nobody once the row says what
`serialize` attaches to. Named so the choice is a choice.

Raised by the build note on THE-DECLARATION-CARRIES-SETUP-SERIALIZE.
