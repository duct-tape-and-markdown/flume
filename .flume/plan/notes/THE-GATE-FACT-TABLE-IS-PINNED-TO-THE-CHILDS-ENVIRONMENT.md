# The doc-section cutter is spelled four times across two test files

Shipped as predicted: the pin lives in tests/harnessChain.test.ts beside
`flumeEnvSeenBy`, reading the table under *What a declared command gate's
child reads* against the FLUME_ set an afterMerge gate's real child saw.
Verified red on a renamed row.

Debt observed: the "section, heading line through the line before the next
heading" cutter is now written out four times - three separate `sectionOf`
consts in tests/examples.test.ts (supervisor-policy, adoption, gate walks)
and a fourth inline copy this entry added, since it could not import one
from a sibling test file. That is a helper spelled in several modules with
no home (`.claude/rules/engineering.md`, *A module is one job*); every new
doc pin copies it again. Target shape: one cutter under tests/helpers/,
imported by both files. Correctness-adjacent only weakly - a mis-cut span
is caught by each site's own anchor assertion - so plan's call whether it
files as an entry or a debt line.
