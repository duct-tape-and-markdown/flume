# `docs/CLI.md` owes a phrasing convention that lives only in a test comment

`CLI-DOC-74-PIN-READS-THE-VERB-SET` generalized the exit-code range case off
`topLevelCommandNames()`, so every advertised verb's section is read for the
codes it names. `NAMED_EXIT_CODE` (`tests/cliHelp.test.ts`) keys on a code
carrying its own introducing verb with no backtick between —
`/\bexits?\b[^`\n]{0,24}`(\d+)`/gi` — because these sections also backtick
integers that are *values* (`--max`'s default 50), and a value read as a code
would put the page permanently at odds with every producer.

`flume friction` was the one section stating its later codes under a single
leading "Exits"; it now repeats the verb per clause, like the page's nine
others. The phrasing is now load-bearing for the pin, and the convention is
stated nowhere but that reader's doc comment. A section written in
enumeration form reds with `expected [ +0, 2 ] to include 74`, and nothing
tells the author the fix is the verb, not the row.

## Options

1. **Teach the reader list continuation** under one leading "Exits". Costs
   exactly the value-vs-code discrimination the comment exists for: inside a
   semicolon list, `50` and `74` are indistinguishable.
2. **State the convention on `docs/CLI.md`.** Prose about a `docs/` page's
   house style, which `.claude/rules/engineering.md`, *Narration is the
   ladder's bottom rung* leaves with its authors — a human call, not an entry.
3. **Leave the convention where it is and fix the diagnostic.** The range
   assertion carries a message naming what the page owes ("every code a
   section means as a code carries its own introducing verb"), so the red is
   actionable at the moment it fires. Cheapest, and it does not decide 1 or 2.

I'd take 3: it removes the harm without settling house style. It carries no
clean `per` cite of its own, so it rides whichever of 1/2 you rule.

Filed from the build note on `CLI-DOC-74-PIN-READS-THE-VERB-SET`.
