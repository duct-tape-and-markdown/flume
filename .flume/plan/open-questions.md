# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Does the realpath platform fact cover node's async form?

**Status: NEEDS AMENDMENT** — the answer looks clear; closing it is a `.claude/rules/platform-facts.md` edit no autonomous phase may make.

`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\` prefix only where nothing resolved*, states the JS-vs-`.native` split for the sync form alone. The namespaced-path scan refuses a composed path at `realpathSync` on that authority and admits one at the bare async `realpath` — declared and cited at the site (`PATH_CONTRACTS`, `tests/helpers/namespacedFsScan.ts`). Verified this tick: no `src/` or `harness/` module imports the async form, so nothing is broken today; the first that does ships green over code that throws on win32, where no behavior test in this suite can look.

- **Widen the page** to state the fact for both spellings (`fs.realpath` carries the same `.native` head). The scan follows in one flag, and the widening touches no call site that exists — recommended.
- **Leave it.** The refusal stays scoped to the symbol the page names, and the gap re-opens as a finding the first time an async `realpath` lands.

## Can a citation's named home be pinned, or does the pin stay token-only?

**Status: PARKED** — the bound is a ratified phrase, so only a human moves it.

`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*, scopes the comment-citation pin to "the token, never its meaning". So a comment naming a file that no longer holds the symbol beside it stays green: four such sites were verified this tick and filed as CITATIONS-FOLLOW-THE-JOBS-THAT-MOVED, none of them caught by any instrument. *A module is one job* asks each split to re-home the citations it strands, and nothing checks that it did.

- **Widen the phrase** so a pin may pair a backticked repo path with a backticked identifier next to it and resolve the declaration. Catches the whole class; the false-positive risk is a comment naming a file for context rather than as a home (`tests/cli.test.ts:990` is one).
- **Leave it token-only.** The bound stays simple and the class stays prose-held, re-found by whoever reads the file next.
