# The Phase field table is the doc's last unpinned restatement — and it is missing two capabilities

Pinning the `Gate` block and the quoted plan phase leaves one restatement in
docs/CHAIN-AUTHORING.md with nothing comparing it to source: the §1 field
table (:137-:152), introduced as "the full interface lives in `src/Phase.ts`.
The fields that matter". Its subset framing blocks the equality pin the other
two now take, but the one-sided direction is checkable — no row may name a
field `Phase` does not declare.

While reading both sides for that: `src/Phase.ts` declares `scopeWritesToEntry`
(:319) and `shipped` (:376); **neither string appears anywhere in
docs/CHAIN-AUTHORING.md**. `shipped` is the predicate this repo's own chain
uses for the build park signal, and `scopeWritesToEntry` is what narrows a
fanout fence to the assigned entry — a chain author reading the authoring doc
end to end cannot learn either exists. That is a doc gap, not drift, so it
wants its own entry (and a decision on whether the table gains rows or the
capabilities get prose of their own) rather than a pin.
