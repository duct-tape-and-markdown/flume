# Every other pathspec call site still parses magic

Shipped as written: the `ls-tree` probe now runs under `--literal-pathspecs`,
verified failing on the pre-fix tree for both named tests. Two things for the
next tick.

**Sibling exposure, unverified.** `readFileAtRef` was not the only place a
host-composed path is handed to git as a pathspec. Same shape, same
leading-colon exposure, none probed this tick: `commitPaths`
(`src/git.ts:554`, `git add -- ...paths` over the agent's declared files) and
`src/job.ts:289,290,293,443,445,449`
(`add`/`status`/`commit`/`ls-files`/`rm`, each over a job's `rel`). A declared
path beginning with `:` would be parsed as magic at each. Worth one entry
carrying `--literal-pathspecs` into a shared spelling rather than six
patches — "The fix lands at the mechanism" suggests a wrapper, not a flag
repeated per call site.

**Platform fact, no home.** Measured git 2.43: `--literal-pathspecs` is a
*main-command* option only — `git ls-tree --literal-pathspecs` exits 129,
`unknown option`. It must precede the subcommand. That belongs in
`.claude/rules/platform-facts.md`, which a build tick cannot write; it is in
the `readFileAtRef` doc comment for now.
