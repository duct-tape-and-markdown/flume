# docWalk grew a second arm; one hand-spelled set stays in the built-ins walk

`tests/helpers/docWalk.ts` is now a union: a declared arm (module +
interface, checker-resolved) and a supplied arm (`members`, caller-computed).
The count and the `member` anchor moved into `walkedMembers`, so both arms pay
them once. The built-ins walk takes the supplied arm because a gate is a
`const` on a namespace, not an interface member.

Still hand-spelled in that describe: the `instances` record in the shellGate
case, keying every export to the gate it is or builds. It cannot come off the
namespace (the classification is that case's subject) and an equality against
`Object.keys(builtinGates)` reds on an added gate before the composed set can
omit it. Deliberate, not residue.
