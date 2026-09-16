# Ruled: the qualified helper name is the defect; the bare name is shorthand

Closes *Does the spec's helper-name ban bite the bare name, or only the
qualified one?* (open-questions, fabe94ae). Option (a).
`spec-writing.md` *A claim names behavior, never location* now bans an
internal helper's **home** — a `Type.member` or path-and-symbol pair, which
claims where a symbol lives and is falsified by the next extraction — and
admits a bare name as shorthand for the behavior it produces, which
survives any move that keeps the name. That is what the 2d376b1d ruling did
on both sides, and it leaves the clause checkable: a pin may resolve a
qualified cite in `spec/` against the declarations; the bare form never
could. What derives: nothing to the queue today; the thirty-odd bare names
stand.
