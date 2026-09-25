# Field: undeclared shared writes collide at merge

Downstream report, 0.19, item 15. Priority 30, and a question, not an entry.
Three of the consumer's ten real merge conflicts were on files outside the
shipping entry's `files`; a fourth was declared by one writer and not the
other, so partitioning could not serialize them. `scopeWritesToEntry` exists
but is off by default, and nothing documents pairing it with
`entryChannelPaths` for a phase that legitimately writes shared files.

The fork is the human's: turn scoping on in the harness's build phase, which
refuses undeclared writes at the cost of more parks; or leave it off and
document the pairing. Name both, with the consumer's numbers.
