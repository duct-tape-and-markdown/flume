# `spec/cli.md` holds the only unheld copy of two CLI defaults — drop the numbers, or carve `spec/` into the suite?

From the build note THE-TICK-BUDGET-DEFAULT-HAS-ONE-HOME, which shipped both
defaults to one home each (`DEFAULT_TICK_BUDGET` for `flume loop --max`,
`DEFAULT_LOG_VERDICTS` for `flume log -n`), with both `--help` pages
interpolating them.

Verified this tick: `spec/cli.md`, *Subcommand surface* states the loop cap as
"(default 50)" and the log count as "(default 10)". After that entry those are
the only copies of either number that **no mechanism holds** — bumping the
constant moves the verb and both help pages together and leaves the spec
silently stale.

## Why this needs you rather than an entry

`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* rules
`spec/` prose out of the suite by name: prose about the harness itself "is held
by its authors and is never promoted into the suite", with carve-outs for `docs/`
pages, the README, and doc comments reachable from the exports map. So the
obvious pin — read those two lines against the constants, the way
`tests/docSections.test.ts` already reads `docs/` pages — is forbidden as the
posture reads today.

## The fork

1. **The sentences stop naming numbers.** "(default 50)" becomes "(the engine's
   declared default)". Spec states behavior; the value lives where the program
   holds it, and nothing can go stale. No carve-out, no new pin.
2. **Carve `spec/` in for values only.** Amend the ladder's carve-out list so a
   backticked or parenthesized *value* on a spec page may be pinned against the
   constant it names, while spec prose stays unpinned for what it says. Buys a
   mechanism; widens what the suite reads against prose, which that section is
   deliberately narrow about.
3. **Leave both numbers.** They are small, and a human maintains the page.

I lean 1: it is the only option that removes the second copy rather than
policing it, and it is one edit on a page you already own. 2 is a posture change
I should not make on a convenience.
