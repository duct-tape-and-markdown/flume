# The section arm now refuses the root the page arm exempts

Shipped: `scanRenderedCitations` partitions its section cites. A cite whose
page sits under `consumerRoot` is a finding on its face; everything else
still resolves against this checkout. The page half is untouched — a page
name under that root is still dropped from the judged set.

Measured on this tree before the change: shipped surfaces state four section
cites (three from `flume loop`/`flume friction --help` into `docs/CLI.md`,
one from `harness/templates/PROTOCOL.md` into `docs/CHAIN-AUTHORING.md`) and
none under `.flume/`, so the new pin was green on the base as filed.

Two things a later tick should know:

1. The fixture now holds `.probe/CONVENTIONS.md` on disk with the heading the
   adopt surface cites, because that is the only way the case reds on the base
   — the old arm resolved the cite green off this repo's copy. The page arm's
   two exemption cases still read `.probe/PROTOCOL.md`, which the fixture
   deliberately does not hold. A change to either arm has to keep both trees:
   one path present, one absent, under the same root.

2. Non-consumer section cites still resolve against the working tree rather
   than against the packed set. That is not a hole today — the page arm reds
   the page name when the manifest subtracts it, so a cite into a section of
   an unpacked `docs/` page is already reported one step earlier. If the page
   arm's authority ever narrows differently from the section arm's, that
   coupling is where it breaks.
