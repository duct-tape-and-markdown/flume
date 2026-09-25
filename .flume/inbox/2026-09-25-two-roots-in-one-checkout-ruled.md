# Ruled: a second state root in one checkout is refused at resolution

Answers `questions/two-state-roots-in-one-clone-collide-at-the-branch.md`.
(a), by the operator. The one-root-per-checkout ruling stands, and the engine
now enforces it where it is broken: `spec/jobs.md`, *The checkout is the unit
of isolation* says so (this ruling's commit). Priority 30, field report item 4.
One entry, with the repro the question names: two state roots in one checkout,
one singleton tick each, the second refused at resolution naming both roots.

Not decided here: two linked checkouts of one repository share one ref
namespace, so the spec's own recipe for two efforts collides on a singleton's
branch. That is a separate question the operator is ruling.
