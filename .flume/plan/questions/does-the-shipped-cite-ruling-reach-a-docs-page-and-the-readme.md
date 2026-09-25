# Does "a shipped page cites what the install carries" reach a `docs/` page and the README?

Residual of the ruling in `spec/harness.md`, *Adoption and upgrade*. The
mechanical half of that ruling files as
`THE-SHIPPED-PAGE-CITE-RESOLVES-AGAINST-THE-PACKED-SET`, scoped to the three
kinds the paragraph enumerates. This is the class it leaves open.

## The finding

The paragraph names its subject by example: "A page the package ships — the
`PROTOCOL.md` init writes, a prompt, a `--help` literal". Those three are
exactly what `shippedPages()` renders (`tests/helpers/shippedHelp.ts`), and the
five sites in them are the entry's scope.

But `docs/` and `README.md` are in `package.json`'s `files` too — the same
"install carries" the ruling resolves against. A consumer who opens
`node_modules/@dtmd/flume/docs/CLI.md` cannot follow a `spec/loop.md` pointer
any more than they can follow the template's. Measured this tick across the
pages the manifest packs:

- `spec/*.md` cites: `docs/CHAIN-AUTHORING.md` 18, `docs/CLI.md` 9,
  `docs/MIGRATING-0.13.md` 4, `README.md` 2, `docs/LAYERS.md` 2,
  `docs/INTENT.md` 2, `docs/MIGRATING-0.18.md` 2, `docs/MIGRATING-0.12.md` 2,
  and one each in `MIGRATING-0.10/0.11/0.14` — 45 sites.
- `.claude/rules/*.md` cites: `docs/LAYERS.md` 4, `docs/CHAIN-AUTHORING.md` 7,
  `docs/MIGRATING-0.15.md` 2, `docs/CLI.md` 1, `docs/INTENT.md` 1,
  `docs/MIGRATING-0.10.md` 1 — 16 sites. Neither tree is packed.

So ~61 pointers a consumer holds and cannot follow, under a rationale that does
not distinguish them from the five the entry fixes.

## Why it is not obvious

A `docs/` page has two readers and the three enumerated kinds have one. The
`--help` literal and the generated `PROTOCOL.md` reach only an operator or a
consumer; `docs/CHAIN-AUTHORING.md` is also this repository's own authoring
guide, read in a checkout where `spec/chain.md` resolves and where the cite is
the contributor's path to the contract. Deleting it loses information with no
shipped home — and unlike the template's case, the fact usually *is* already
stated on the page, so the cite is provenance rather than a pointer to content.

`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* already
reads a migration guide as out of scope by construction, "since a migration
guide or a survey names retired surface on purpose" — evidence the corpus
already treats packed-but-historical pages differently from live surface.

## The fork

**(a) Extend the subject to every packed page.** One rule, one pin, no
audience test: every page the manifest packs resolves its page names against
the packed set. Cost: ~61 rewrites; a contributor pointer with no shipped
replacement is deleted rather than re-homed; the migration guides need the
carve-out the ladder already gives them spelled a second time.

**(b) Keep the subject at the three enumerated kinds.** The pin's subject
stays `shippedPages()`, and a `docs/` page is dual-audience surface whose
`spec/` cite is provenance for the contributor, not a pointer for the
consumer. Cost: the ruling's own rationale is left applying to pages it does
not govern, which is the shape of the defect the question this one descends
from was opened over.

**(c) Split by what the cite is for.** A `docs/` page may cite the spec corpus
for *provenance* — where the contract is maintained — and never as the place a
reader goes for content the page does not state. Cost: "provenance vs
pointer" is a judgement no pin can make, so this is prose at the ladder's
bottom rung governing 61 sites, which is the rung the corpus is trying to
climb off.

## No recommendation

The research does not settle it: (a) and (b) each honour one half of the
ruling's own sentence and drop the other, and the cost is a real rewrite
against a real information loss. It is a scope call on who `docs/` is for —
the adopter or the contributor — which is the human's, not derivable from the
tree.

Worth naming: if the answer is (a), the entry above is its first slice and the
remaining sites want their own wave, not a widened `files`.
