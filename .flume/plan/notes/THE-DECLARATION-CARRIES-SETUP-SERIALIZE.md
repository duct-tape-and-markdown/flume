# serialize without a restore parses, and holds nothing

Judgment call the spec row does not settle: `setup.serialize` names the
*declared restore* ("runs the restore one worktree at a time"), so a
declaration carrying `serialize` but no `restore` parses and queues nothing —
the engine's own lockfile install stays parallel, which is what the row's
"the wave's other provisioning stays parallel" is about and what the second
named test pins.

The strict-schema posture in `harness/declaration.ts` ("a field the package
never reads is a belief nothing honours") argues the other way: refuse the
pair at the parse, the way `slices.sweep` is refused when `plan-sweep` is
off. I did not, because the entry's own `tests[]` names a case that needs a
serialize-declaring chain whose provisioning is the engine installer — which
that refusal makes unwritable.

If the intended reading is the refusal, it is one `superRefine` on the setup
object plus a rewritten second test; the spec row would want a clause saying
so. Worth a human ruling either way, since it is the one place this knob can
be declared and do nothing.
