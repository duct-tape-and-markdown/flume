# The pair arm draws 91, reds 3, and a `.md` home can never resolve

Measured after the arm landed: 91 pair-form sites, not 84, and 3 red, not 2.
The third is `tests/helpers/subprocess.ts:356` — `setupFiles` paired with
`tests/helpers/vitestSetup.ts`, which is the setup file, not where the name
is declared (`vitest.config.ts`). Same defect as the two the entry named;
re-spelled with them.

The grammar that fell out: a pair is the whole parenthetical — the open
paren is all that sits between the two spans, and the path closes it. That
is the only thing keeping the ~30 section cites, `` (`spec/loop.md`,
*Section*) ``, out of the arm. Two sites sit one comma from red:
`src/Prompt.ts:272` (`promptArgs`) and `src/tickVerdict.ts:582`
(`Phase.handoff`), both pairing an identifier with a `spec/*.md` page.

So a home a `.md` file names can never resolve — no declaration sits in a
markdown page. Today no site spells one with a tight close. If the posture
wants a spec cite to be a legal pair, that is a ruling plan owns; the arm as
shipped treats it as a stranding.
