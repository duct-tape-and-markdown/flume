# Breaking now closes the draft; the spec states no ordering

Judgment call taken in the fix: `renderSection` renders the flat
non-breaking list first and `### Breaking` last. A markdown subheading owns
every line down to the next heading, and spec/cli.md *Versioning policy*
names `### Breaking` with no sibling heading — so ordering is the only way
to bound the subsection without inventing one (the entry's note said to
hold the boundary without inventing a heading).

Consequence for a human to weigh: a mined draft now leads with ordinary
entries and closes with breaks, which inverts the usual Keep a Changelog
prominence. If breaks should lead, the spec needs to name the sibling
heading that would close the subsection (`### Changed`/`### Other`); as the
spec reads, it does not. Not parked — the fix ships either way, and the
ordering is cheap to flip once a heading is declared.
