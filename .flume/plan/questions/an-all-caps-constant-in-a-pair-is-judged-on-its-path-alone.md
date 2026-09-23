# A cross-module cite of an all-caps constant has no fully-resolved form

`isSubject` (`tests/helpers/commentCitations.ts`) refuses a capitals-only span
by construction — "a word in capitals alone … is how prose names an acronym or
a constant it did not spell out", with `JSON` as the case that would red. The
pair arm inherits that rule through `isIdentifierSubject`, so a comment writing
`` `EX_MOUNT_DEAD` (`src/exitCodes.ts`) `` reads to a human as a declaration at
a home and is judged on the path half alone: rename the constant and the cite
still resolves.

Eleven sites in the tree spell the idiom today — `EX_MOUNT_DEAD` and
`EX_TERMINAL_MISCONFIG` in `src/Dispatcher.ts`, `CORE_ENTRY_FIELDS` in
`src/Phase.ts`, `STATE_ROOT_NAMES` in `src/runtimeIgnores.ts`,
`NO_COMMIT_MODES` in `src/waveTick.ts`, three `DEFAULT_*` cites in
`tests/docComments.test.ts`, `RUNTIME_IGNORES` in `tests/cli.test.ts`. The gap
predates the link arm that surfaced it; the link tag's re-homing just moved
four more cites into this shape.

## Options

1. **Widen the pair arm's identifier half to admit an all-caps name.** The
   ambiguity the subject rule fences is a *bare* backticked acronym in prose —
   and a name inside a pair has already claimed to be a declaration at a named
   home, so the fence has nothing left to protect there. One predicate on
   `isIdentifierSubject`, and eleven cites gain their check. Costs: a comment
   writing `` `JSON` (`src/foo.ts`) `` reds, which is the arm working.
2. **Leave those cites judged on the path alone and say so.** One sentence on
   `engineering.md`'s carve-out naming the exclusion's reach — the pair's
   identifier half is held to the same subject rule, so an all-caps name is
   context and the path is what resolves. Cheapest; leaves eleven cites reading
   as pins that are not.
3. **Spell the cite as a link tag where the module can follow it.**
   `{@link EX_MOUNT_DEAD}` is judged as a declaration reference rather than a
   subject, so an all-caps target resolves there already — but it resolves
   *from the citing module*. That splits the eleven: the four test-file cites
   import the name they cite (`DEFAULT_ABORT_THRESHOLD`,
   `tests/docComments.test.ts`; `RUNTIME_IGNORES`, `tests/cli.test.ts`) and
   could carry a link tag today, while the `src/` cites do not —
   `src/Dispatcher.ts` imports nothing from `src/exitCodes.ts`, which is why
   the four link tags this note came from were re-homed to the pair form to
   begin with. A partial fix, and a convention nothing enforces.

I would take 1: the pair's own shape is the disambiguator the bare-span rule
lacks, and the rule page's words ("a word in capitals alone, which is how
[prose] names an acronym") are about a span standing by itself. If you would
rather the fence stay absolute, 2 is one sentence and the eleven cites stop
reading as pins they are not.

Either way the answer is a phrase on `engineering.md`, *Narration is the
ladder's bottom rung*, whose carve-out enumerates the classes the suite
resolves — your surface, not a tick's.

Filed from the build note on `LINK-REFERENCES-RESOLVE-FROM-THE-CITING-MODULE`.
