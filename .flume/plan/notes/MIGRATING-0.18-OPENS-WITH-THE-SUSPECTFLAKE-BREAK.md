# The 0.18 note is open; two pins fence what a migration page may write

`docs/MIGRATING-0.18.md` shipped with README's pointer list as its inbound
edge: CHANGELOG's `[Unreleased]` carries no section to link from, and a build
tick writes no changelog line. At the cut, the curating human moves or
duplicates that link under the 0.18 release entry — the pin takes either
root, so nothing reds if the README bullet simply stays.

Two existing pins shaped the page's code samples; a later break's section
will hit both:

- `tests/priorAttempts.test.ts`, *no docs page composes a prior-attempt map
  key by hand* reds on a sample writing `` `entry:${slug}` ``, and its
  closing assertion pins the keyer-naming pages to exactly
  `docs/CHAIN-AUTHORING.md` and `docs/MIGRATING-0.16.md` — so a note may
  neither compose the key nor name `entryAttemptKey` to avoid composing it.
  The page reads records off `EntryRefusalContext.priorAttempt` instead,
  which needs no key. A third page legitimately needing the keyer is an edit
  to that assertion, not a workaround.
- `tests/pageAnchors.test.ts` resolves a `§ N` against the *citing* page's
  own numbering, so a note cannot cite a neighbour's section as
  `MIGRATING-0.13.md § 2.7`. The page names 0.13's item without the sign.

One content flag for the cut's curation: the only other 0.18-line change a
consumer of `@dtmd/flume/harness` feels is `cb55183c`, the judge gate
declaring `blamesSpan: false` on a base-red suite. It is a behavior change,
not an API break, so it has no `### Breaking` line of its own; the note
carries it as a closing paragraph of its section 1. If the cut decides
harness-gate behavior changes deserve their own section, that paragraph is
the seed.
