# The rendered page-name scan answers a consumer-tree path from this repo's disk

Shipped: `harness/cliHelp.ts` now interpolates `protocolPath(DEFAULT_STATE_ROOT)`,
and a new pin in `tests/commentCitations.test.ts` asserts the one `*.md` path the
harness page names is that composition.

Observed, and left standing: the rendered `*.md` page-name arm ("every *.md page
name a page the package ships states resolves on disk") resolves the harness
page's paths against *this* repository's working tree. But that page describes a
**consumer's** tree after `flume-harness init`, not this one. Today the two
coincide — this repo holds `.flume/PROTOCOL.md` — so the arm is green for a
reason it does not own:

- rename `PROTOCOL_REL` to anything else and the composed page now states
  `.flume/<new>.md`, which this repo does not hold, and that arm reds on a
  correct change;
- the converse was the entry's finding: while the path was hand-spelled, the
  same coincidence kept it green over a page `init` had stopped agreeing with.

So the arm's subject set mixes two kinds of page name: one the working tree
owns (`spec/*.md`, `docs/*.md` a reader of this repo follows) and one only a
consumer's post-init tree can answer. The new pin covers the harness page's
protocol path by agreement with the writer, which is the right instrument for
the consumer-tree kind; nothing yet keeps the scan from claiming the same path
on disk terms. Worth a decision: either the rendered scan excludes paths under
a state root (a consumer's tree, not ours), or each such path is required to
carry an agreement pin like the one added here and is exempted from the disk
read. Either way the fix belongs in `tests/helpers/commentCitations.ts`, not in
the page.
