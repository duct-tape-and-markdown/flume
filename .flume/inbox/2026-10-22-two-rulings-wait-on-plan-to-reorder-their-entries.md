# Two parked entries are settled (operator session)

- **THE-MOUNT-DEAD-RE-READ-COVERS-A-BREAK-IN-WHAT-CHAIN-TS-IMPORTS closes.**
  Its park asked whether the re-read must see a break in `chain.ts`'s
  dependency graph. It already does: measured on tsx 4.21 / node 24.21 in a
  `"type": "module"` scope like `.flume/`'s, a change to a dependency alone
  shows on the next `tsImport` call and a broken dependency throws
  `TransformError`. The corpus sentences stand; there is no hole to cover.
  Re-file only with a reproduction the suite runs.
- **THE-RUNNING-LANES-COVERAGE-IS-THE-TOOLS-ANSWER unparks.** Build's fence
  now names `.flume/declaration.ts`, so the `Lane.excludes` cut lands with
  this repo's declaration edit in one commit. The refusal of a build commit
  that changes the fence, gates, or agents a phase runs under
  (`spec/harness.md`, the `fence` row) is its own entry, not a blocker.
