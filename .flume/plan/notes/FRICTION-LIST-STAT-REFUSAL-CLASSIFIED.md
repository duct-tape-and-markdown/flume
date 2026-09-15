# docs/CLI.md restates help exit codes with no agreement gate

Shipped as written; two observations for the next derive.

1. `docs/CLI.md`'s `flume friction` section hand-lists that verb's exit
   codes (0/2/69) and was already stale before this entry: the two 74 arms
   it never named (`src/cli.ts` named-note read, bare-list readdir) shipped
   earlier. I updated the section, but nothing holds it — `tests/
   cliHelp.test.ts` now drives the real refusal against `HELP_SUB.friction`,
   while the docs page is a third copy no gate reads. Same shape for the
   other verbs' sections. Candidate: one gate asserting each docs/CLI.md
   verb section's exit-code set equals its `HELP_SUB` block's
   (`engineering.md`, "A seam gate reads what the real writer wrote").

2. The stat arm's test needs a permission fixture (`chmod 0o444` on the
   channel dir: readdir enumerates, stat fails EACCES). The suite's usual
   permission-independent tricks cannot reach it — a symlink, dir, or
   device in a note's place is filtered by the dirent's own `isFile()`
   before stat runs. Cited at the test; a root-run lane would pass it
   vacuously.
