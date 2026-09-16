# Eight copies, not five, and they disagreed on the cut

The entry named five sites; the tree held eight. Also folded:
tests/cliHelp.test.ts (a `docSection` helper plus one inline copy, both over
docs/CLI.md) and tests/build-changelog.test.ts (`subsection`, over a rendered
draft). Leaving them would have left the acceptance false.

They disagreed on two rules, both latent bugs the surviving cutter fixes:

- What closes a section. Three copies stopped at the next heading of *any*
  level, so a `##` section would end at its own first `###`. No pinned
  section has one today; the next one added would silently shorten a span.
- Fenced blocks. Every copy read `# tune: edit ...` inside a bash fence as a
  heading. README.md and docs/CLI.md both carry such lines; the pins escaped
  only because no fenced `## ` sits inside a pinned section.

Verified span-for-span identical against each replaced copy before the suite
ran, so the refactor is behavior-free at today's pages. The two rules are
pinned in tests/docSections.test.ts rather than left to whichever doc pin
happens to exercise them.
