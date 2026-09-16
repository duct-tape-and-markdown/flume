# Two smaller gaps from the same pilot (pilot follow-up from a win32 consumer with a multi-job bay, relayed by the operator)

- **`capabilities` has no declaration field.** A job asserts the
  capabilities its entries may require, and the pilot's per-job
  `declaration.json` carries them; the harness declaration cannot. If the
  engine's `Chain` carries capability assertions, the declaration mirrors
  the field and the factory passes it through; if it does not, this is the
  engine's gap first. Plan verifies which.
- **0.13, 0.14 and 0.15 shipped breaks with no migration note.** The 0.16
  note now names them at its head; the pilot's one compiler-invisible break
  was 0.15's. Ruled at `spec/cli.md` *Versioning policy*: every minor with
  a `### Breaking` section has a note. What derives: three notes under
  `docs/`, each from its changelog section.

Already ruled today and worth saying back to the pilot: the git floor is
warned at loop start, a dotfile is not a friction note, and the zombie
brake is the default handoff's.
