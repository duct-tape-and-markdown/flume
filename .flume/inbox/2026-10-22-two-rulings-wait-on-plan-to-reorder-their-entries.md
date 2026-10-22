# Two rulings change what two parked entries wait on (operator session)

- **tsImport re-reads the dependency subgraph in an ESM scope.** Measured on
  tsx 4.21 / node 24.21, in a `"type": "module"` scope like `.flume/`'s: a
  change to a dependency alone shows on the next `tsImport` call, and a
  broken dependency throws `TransformError`. The page sentence plan read as
  overstated stands. THE-MOUNT-DEAD-RE-READ-COVERS-A-BREAK-IN-WHAT-CHAIN-TS-IMPORTS
  rests on the opposite measurement: reproduce its hole as a case the suite
  runs, or close it.
- **Build may write `.flume/declaration.ts` once the rails refusal ships**
  (`spec/harness.md`, the `fence` row). THE-RUNNING-LANES-COVERAGE-IS-THE-TOOLS-ANSWER
  stops waiting on a question and is `blockedBy` the entry that ships the
  refusal. The fence line itself lands from an operator session after that
  entry ships, since build's fence cannot widen itself.
