# A platform fact the CJS pins turned up, unhomed

Both arms are pinned at both verbs, through the real CLI, and the note's
report of a standing `check` pin was right to doubt: there was none.

Measured while choosing the CJS fixture (tsx 4.21, node 22): the
import-statement signature `isCjsContextLoadFailure` matches is
**unreachable through a CLI this repo spawns**. The test lane runs
`node <tsx/dist/cli.mjs> src/cli.ts`, so tsx's ESM loader is already
registered process-wide, and a chain under a CJS-context `package.json`
resolves and parses as a module regardless — my first fixture (type
"commonjs" plus a real import) loaded clean and reached the
factory-shape check, exit 69, not the refusal. Only the transform arm
refuses there, because esbuild reads the manifest itself for its output
format. In production the CLI runs under plain node off `dist/`, where
`tsImport` does the loading and the parse arm is reachable, which is what
tests/Dispatcher.test.ts drives at the loader directly.

That is an external fact no test pins: a copy lives in a comment in
tests/cli.test.ts, beside the fixture it decided, where only an agent
already in that file reads it. Candidate section for
.claude/rules/platform-facts.md, beside *tsx decides a module's interop
shape from the nearest package.json type* — human's call, and the comment
shrinks to a pointer if it lands.

Two smaller observations:

- `refuseCjsContextHost` prints no surface name, so the CJS headline is
  byte-identical at every verb while the mount-dead line names the verb.
  Consistent with the spec section (the fix is the headline), but an
  operator reading a log cannot tell which verb refused.
- Plan predicted a shared fixture in tests/helpers/repoChain.ts. Kept
  local: two cases in one suite, and a helper export with no second
  consumer is the shape *An export earns its consumer* fences. It moves
  the moment a second suite wants a CJS-context host.
