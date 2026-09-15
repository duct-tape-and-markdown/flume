# Two pathspec facts the one spelling did not reach

The spelling is `literalPathspecEnv()` (`src/git.ts`), set on the child env at
each of the three git wrappers rather than per argument — so it covers every
pathspec of every invocation those wrappers make, including ones not written
yet. `--literal-pathspecs` in `readFileAtRef` is retired by it.

Two things it deliberately does not cover:

1. **`src/job.ts` still hands git a host-separator path.** `rel =
   join(".flume","jobs",name)` reaches `add`/`status`/`commit`/`ls-files`/`rm`
   unconverted, where the engine's own rule is `gitPath` (`src/paths.ts`). On
   win32 that is `.flume\jobs\<name>`, matching nothing under either dialect
   (default parse reads `\` as a wildmatch escape; literal reads it as a
   byte) — so `job rm` reports "no tracked harness". Latent under-match, win32
   only. Not fixed here: the repro runs on no host this suite has, so no test
   could ship with it.

2. **Chains spawn git outside the wrappers.**
   `examples/backlog-groomer-chain.ts` runs `git add <path>` itself, in the
   default dialect. `literalPathspecEnv` is not on `src/index.ts`, so a chain
   cannot adopt the engine's dialect.
