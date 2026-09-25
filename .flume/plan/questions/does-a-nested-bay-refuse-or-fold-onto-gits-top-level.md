# A nested bay is now refused, not "not disambiguated" — does the sentence follow the refusal, or does the fold arm ship?

`ca763945` shipped the refuse arm of the fork
`THE-BAY-ROOT-IS-PROVEN-TO-BE-THE-ROOT-GIT-NAMES-PATHS-FROM` declared: a
resolved bay root that is not `git rev-parse --show-toplevel` exits `74`
naming both roots, before the first path is composed against it
(`bayRootDisagreement`, `src/cli.ts:243`). The entry's note carries two
things to the human, and neither is plan's to settle.

## 1. `spec/cli.md` now over-states what the walk does

`spec/cli.md`, *Bay discovery walks up to the nearest `.flume`* closes:

> Nested bays are not disambiguated: the walk picks the nearest, same as git.

On disk the walk still picks the nearest — and a nearest sitting below git's
top-level is then refused rather than used. So the sentence states a
behavior the verb no longer has. It took nothing working away (the
`sub/.flume` case the entry reproduced was already broken: every path the run
hands git is named from the top-level, so a state root composed against a
different root loses that prefix on the fence globs, the queue pathspec and
the state root a hook reads). But the corpus states present truth, and only a
human edits `spec/`.

**Proposed edit, if the refusal stands** — replace that line with the two
facts the code has: the walk picks the nearest, and a nearest below the root
git names paths from is refused (`74`), naming both roots; run from the
top-level with `FLUME_DIR` naming the nested bay, which resolves
`stateRootRel` as `sub/.flume` and is correct in git's alphabet. That remedy
is already the refusal message's own (`src/cli.ts:257`), so the spec line
would be stating what ships rather than adding a rule.

## 2. The fork itself: refuse, or fold?

- **Refuse (shipped).** One proof at the one place the root is resolved,
  ahead of every composition. A nested bay is unusable without `FLUME_DIR`.
  Cost: an operator who deliberately keeps `sub/.flume` loses a layout that
  never actually worked, and learns it from an exit code.
- **Fold.** Keep a nested bay working by folding `stateRootRel` onto git's
  top-level, so the nested bay's paths reach git in git's own alphabet.
  Cost: the fold has to hold at every reporter — the fence globs, the queue
  pathspec, `--name-only` lines — and `posture-sweep.md`, *Standing lenses*
  already names a repo-relative path composed through the host separator as
  its own finding class. That is the complicated arm; per
  `collaboration.md`, *Complexity is a signal*, it wants a reason the
  refusal does not cover.

Plan's read is that (1) follows from what shipped either way — the sentence
is false today — and that (2) needs no code unless a nested bay is a layout
flume means to support. If the answer is "refuse, permanently", (1) is the
whole remedy and this file closes with the `spec/cli.md` edit.
