# The rails gate reads the declaration's default export, which spec/harness.md never states

Shipped: `rails` in the package's discipline set (every phase, `afterCommit`),
`RAILS`/`movedRails` in `harness/declaration.ts`, `api.loadModuleDefault`
reported off `src/chainLoad.ts`.

Three things plan should know.

1. **The entry's note guessed `loadChainModule` as the surface; it is the wrong
   one.** A chain load answers a `Chain`, and the rails are declaration fields
   the `Chain` never carries — the fence a phase runs under is derived through
   `harness/chain.ts`, so comparing two loaded chains would refuse a commit
   that only touched `harness/`. The gate loads `<configDir>/declaration.ts`
   and takes its **default export**, which is what `flume-harness init` writes
   and what this repo's declaration lacked until this commit. `spec/harness.md`,
   *What a consumer declares* names the file but not the export, so the
   package now depends on a convention the spec states nowhere — one sentence
   in that row would close it. Flagging, not filling.

2. **A doc comment in `src/chainLoad.ts` was wrong and is corrected here.** It
   claimed a second in-process `tsImport` of one path "answers the evaluation
   the process already took". Measured on this tree, tsx 4.21, under the CLI's
   registered loader and plain node: that holds only beneath a CJS-context
   manifest (where no URL query busts it); beneath `"type": "module"` — the one
   shape the package supports — a second load re-reads disk. The gate does not
   lean on either: `ctx.configDir` is rebased onto the gate's own worktree, so
   the path it loads is one the dispatcher's own chain load never touched.

3. **The refusal keys on the parse, so a rail moved by a *harness* change is
   invisible to it** — by design (build owns `harness/`), but it means a
   default the package itself moves is not held by anything. If that becomes a
   finding, it is a different gate, not this one widened.
