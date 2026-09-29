# `TickResult.ledgerCommitShas` ships and `spec/chain.md` does not name it — which side is the defect?

From build note THE-WAVE-REPORTS-EVERY-LEDGER-COMMIT-IT-LANDED, item 1. Build
cannot edit `spec/` and neither can plan, so the page and `src/` disagree by one
line until you rule.

Verified this tick:

- `src/Phase.ts:364` declares `ledgerCommitShas?: readonly string[]` on
  `TickResult`, under a hover stating it is every ledger commit a fanout wave
  landed, in landing order, and that `commitSha` is its last element.
- `docs/CHAIN-AUTHORING.md:648` names it in the `handoff` field roster.
- `spec/chain.md`, *What a hook receives* (`:578`) enumerates the `TickResult`
  additions — `pickableAfter`, `flumeDir`/`configDir`, `baseSha`, `entries`,
  `provisionFailures`/`renderFailures`/`gateFailures`/`mergeFailures` — and
  omits this one. `ledgerCommitShas` appears nowhere in `spec/chain.md`.

## The fork

1. **The page is stale — add the bullet.** The section reads exhaustively:
   "the existing facts (`committed`, `commitSha`, …) plus:" followed by one
   bullet per addition. A chain author reading it concludes the field is not
   there. On this reading `ledgerCommitShas` shipped without its spec line and
   the page owes one bullet.
2. **The roster is illustrative** — the section's closing line is "Every
   addition is a fact the dispatcher already computed for its own use", which
   could be the rule and the bullets merely its worked examples. Then nothing
   changes, but say so, because the next producer will read it the other way
   and file this again.

No third option: the field has a consumer-facing hover and a docs roster, so
retiring it is not on the table.

## Why it needs you, not an entry

The disagreement is between `spec/` and `src/`, and `spec/` is the human's
maintenance surface (`.claude/rules/spec-plan-build.md`). There is no edit an
autonomous phase can make that closes it — a build entry could only change
`src/`, which is the side that is right.
