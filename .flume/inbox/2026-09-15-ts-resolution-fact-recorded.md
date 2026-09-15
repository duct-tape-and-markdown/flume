# Amended: the TypeScript directory-resolution fact lives in platform-facts

Closes the open question *A TypeScript module-resolution fact lives in a code
comment; `platform-facts.md` is its home*.

`.claude/rules/platform-facts.md` gains *TypeScript abandons a module lookup
whose directory the host denies*: a custom compiler host serving a virtual
tree must answer `directoryExists` (and `getDirectories`), because
resolution asks for the containing directory before the file and treats a
denied directory as the end of the lookup, silently — every cross-module
import lands as `unknown` and a scan reads an empty reach graph as clean.
The page also names the defence: a judged-count floor above zero.

What derive files: the site comment in `tests/helpers/exportGraph.ts`
shrinks to a pointer at the page (`.claude/rules/engineering.md`,
*Narration is the ladder's bottom rung*).

The question closes; the rule page holds the fact.
