# Ruled: shipped prose cites what the install carries, with no phrase edit

Answers `questions/does-a-shipped-pages-cite-resolve-against-the-consumers-install.md`.
(b) in substance, without the phrase change. `.claude/rules/engineering.md`
says a page name "resolves on disk"; for a page the package ships, the disk
its reader holds is the packed file set, so resolving there reads the phrase
as written for that reader. Editing the page would arm a phrase delta over
the whole domain on a closed rotation to state what the phrase already
implies; that price buys nothing here.

`spec/harness.md`, beside `flume-harness init`, now states it (this ruling's
commit): a shipped page cites `docs/`, the README, or a `--help` page, never
`spec/`; it resolves page names against the shipped file set; it names a
consumer-owned page but never a section in one. That closes the one-step-in
class too.

One entry: rewrite the template's two `spec/harness.md` cites to a shipped
page, adding the records passage to `docs/CHAIN-AUTHORING.md` where no shipped
page states the paths, title line, and byte cap; and a pin arm resolving a
shipped asset's page names against the packed file set, which
`tests/harnessPackaging.test.ts` already builds. Measured drift: the two
template cites.
