# Does a cite in shipped prose resolve against the consumer's install, or the author's tree?

Off note `THE-SHIPPED-HELP-PAGE-NAMES-A-PAGE-THAT-RESOLVES`. The page-name arm
reached the packed assets and passed; what it cannot see is that the tree it
resolved against is not the tree the reader has.

## The finding

`harness/templates/PROTOCOL.md:11` and `:58` cite `spec/harness.md`. That page
is not in `package.json`'s `files` (`dist`, `bin`, `docs`, `examples`,
`README.md`, `LICENSE`, `CHANGELOG.md`), so it ships nowhere — not at a
repo-relative path in an adopting repo, and not under `node_modules` either.
The template is the page every consumer's `PROTOCOL.md` is generated from
(`harness/init.ts`, pinned at `tests/harnessInit.test.ts:519`), so every
consumer's copy carries two pointers they cannot follow.

The pin over it is green, and green as ratified: "every `*.md` page name a page
the package ships states resolves on disk"
(`tests/commentCitations.test.ts:2151`) resolves the name against *this* repo's
working tree, and its own vacuity list asserts `spec/harness.md -> true`.
`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* asks for
exactly that — "a `*.md` page name, with or without backticks, in any tree the
sweep domain names, since a filename resolves on disk" — and
`harness/templates/` is inside `harness/`. So this is the phrase working as
written, not an arm with a hole in it. Changing the verdict means changing the
phrase, which is the human's.

## The same class, one step in

A shipped prompt citing a *section* in a consumer-owned page. `plan-derive.md:40`
cited (`PROTOCOL.md`, *What makes an entry good*), which titles neither
`.flume/PROTOCOL.md:46` ("What makes an entry good, not merely valid") nor
`harness/templates/PROTOCOL.md:25` ("What an entry means here") — and the
consumer edits their copy after generation, so any section name is a guess
whichever spelling is picked. 8b40e4e6 dropped the section half rather than
choose. The instance is closed; the class is not.

## The fork

**(a) Ship `spec/`.** The cite resolves for a consumer and the pin needs no new
arm. Cost: flume's own maintenance corpus becomes consumer surface, including
every sentence it states about *this* repo ("this is flume operating on
flume"), and the spec corpus is sized for the human who maintains it, not for
an adopter reading it cold.

**(b) Shipped prose cites only what the install carries** — `docs/`, the
README, a `--help` page. The two template cites are rewritten, and the pin
gains an arm resolving a *shipped asset's* page names against `package.json`'s
`files` rather than the working tree. Cost: the ratified phrase changes, which
arms a phrase delta over the whole sweep domain — the real price to weigh here.

**(c) Rule the class and excuse the sites.** Shipped prose may name a
consumer-owned page but never a section in one (the ruling the note asked
for), and a `spec/` cite in a shipped asset is declared and cited at the site
as the sanctioned exception. Cost: an excuse per site, and the consumer is
still holding a pointer that resolves nowhere — which is the actual complaint.

## Recommendation

**(b).** The pin's subject is the file set a consumer receives, and driving the
real consumer's view rather than the author's is the shape
`.claude/rules/engineering.md`, *A seam gate reads what the real writer wrote*
already asks for — here the "real consumer" is the packed tarball, which
`tests/harnessPackaging.test.ts` already builds. (a) prices a packaging
decision to fix a prose defect. (c) leaves the dead pointer in the consumer's
generated page, so it answers the class without answering the finding.

Not filed as an entry: the mechanical half — the pin's shipped-asset arm — is
downstream of which of these three the phrase says, and (b) is the only one
that needs it.
