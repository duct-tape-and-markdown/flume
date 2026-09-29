# Does "a range diff compares two trees, so a path born and died inside the span is named by neither" get its own platform-facts section?

From a build note (THE-REVERT-SNAPSHOT-COVERS-THE-SPAN-IT-DIGESTS). The
snapshot that note shipped now lists `base..head` through `diffNameOnly`, and
the `excludeDeleted` selection it added rests on a git behavior that lives in
the tree only as prose at three sites. `CLAUDE.md` says a measured external
fact's home is `.claude/rules/platform-facts.md`, and that page is yours, not
any autonomous phase's, so this needs your ruling before anything moves.

## The fact

Measured this tick, git 2.43.0 on linux (the note measured the same shape).
A span of two commits over a base holding `kept.txt`: the first adds
`born-then-died.txt`; the second deletes both it and `kept.txt` and adds
`survives.txt`.

- `git diff --name-only <base> <head>` names **`kept.txt` and
  `survives.txt`**. It does not name `born-then-died.txt` at all: a range diff
  compares the two end trees, and that path is absent from both.
- `--diff-filter=d` leaves **`survives.txt`** — so over a range the filter can
  only ever drop a path the *base* already held. It is not "the paths the span
  deleted"; it is "the paths the span deleted that were there to begin with".
- `git log --pretty=format: --name-only <base>..<head>` does name all three,
  because it unions each commit's own diff. But `git cat-file -e
  <head>:born-then-died.txt` fails — there is no post-image to read — so the
  wider listing buys a caller that reads content at `head` nothing.
- Over a single commit none of this arises, which is why `showNameOnly`'s
  identically-named flag is the ordinary "drop the deletions" it reads as.

## What the tree already leans on it, by hand

Verified on disk this tick. The *selection* is pinned at both layers; the
born-and-died half is pinned nowhere and stated in prose three times.

- **The fact, stated outright in a doc comment.** `src/git.ts:260`-`:265`
  (the `diffNameOnly` doc): "a path an earlier commit in the span created and
  a later one deleted is named by neither side of the range's trees, and a
  path the span deleted outright is named and unreadable." This is the copy
  `CLAUDE.md` says the page should own.
- **The fact, stated again as a fixture precondition.**
  `tests/priorAttempts.test.ts:999`-`:1002`, the comment on
  `commitTwoStepSpan` explaining why the doomed path is committed *before*
  the span — otherwise the range would never name it and the case would be
  vacuous.
- **The consequence, twice more.** `tests/priorAttempts.test.ts:1073`-`:1075`
  and `tests/git.test.ts:895`-`:896`, both vacuity-pin comments justifying
  that the filtered read had something to drop.
- **Pinned:** `tests/git.test.ts:881` (the selection) and
  `tests/priorAttempts.test.ts` (the snapshot outcome over a span). **Not
  pinned anywhere:** that a born-and-died path reaches neither listing. No
  case plants one — which is consistent with the page's own posture that an
  external tool's behavior lands as prose, not as a test.

## The fork

**(a) Its own section.** Recommended. It is git's behavior, host-independent,
and it retires when `git diff` stops being a two-tree comparison — one expiry
predicate, and a stable one.

**(b) A paragraph inside *Git pathspecs over-match, and the literal spelling
depends on position*,** the page's existing "git's selection is not the
selection you meant" section. Cheaper, but that section's claim is about
pathspec matching and expires on git's pathspec rules, while this one is about
range semantics; two expiry predicates in one section is a section the sweep's
expired-narration lens cannot retire by halves.

Not folded into
`does-the-worktree-realpath-fact-get-a-platform-facts-section.md`: same shape
of ruling, different fact and different expiry predicate, so one answer would
leave the other half of the file standing — the precedent `a40cdcca` set for
exactly this pair.

## What your ruling unblocks

Once a heading exists, `src/git.ts:260` shrinks to a pointer at it and the
three fixture and vacuity comments gain a cite for why they stage the span the
way they do. All are in `src/` and `tests/`, which build can write, so that is
a queue entry the next drain files — it cannot be written before the heading it
has to name, because the citation pin resolves the `*Section*` half against the
page's real headings.

## Related, not part of this question

The spec sentence that describes the snapshot is narrower than what ships, and
now also silent on the boundary this fact draws. That is item 3 of
`spec-sentences-the-shipped-engine-no-longer-matches.md`, amended this tick.
