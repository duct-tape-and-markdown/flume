# The phase list's other reader still calls position "the entry point"

`docs/CHAIN-AUTHORING.md`, *Putting it together*, said the first phase is the
chain's entry point and that cascade led with plan "because a fresh state root
must derive pending before anything can build". No engine behavior backs that:
a bare tick takes the first *awake* phase in declared order and the supervisor
starts children down the list to `maxTicks` (spec/loop.md, *Which phases run*)
- nothing cold-starts `phases[0]`. The only cold-start-by-position reading in
the tree is a proposal, `docs/PRD-dock-collapse.md:115`. I rewrote that
paragraph as priority-not-ladder, since the entry flipped the order it quoted.

Two residues that outlive this entry:

1. `tests/examples.test.ts`, describe "example chains - entry phase is
   machine-wakeable", rests its rationale on the entry-point reading and cites
   `docs/CHAIN-AUTHORING.md`, *1. Declaring a Phase* for a claim that lived in
   *Putting it together* and no longer reads that way. The citation pin is
   green (the section exists); the claim behind it is not. The pin still buys
   something - a `phases[0]` in `humanOnly` is a chain no bare tick starts
   while that is the only awake name - but the doc comment needs re-siting.

2. Same page, the `humanOnly` paragraph: "Cascade declares it empty: both its
   phases derive from disk". Cascade has had three phases since the plan
   slices split. Pre-existing, untouched here.

Also: the ladder drive ticked `chain.phases[0]` to prove the dispatcher's
roots. That fixture writes `prompts/plan.md` only and build wants an assigned
entry, so build-first would have reddened it on a scheduling fact the case is
not about. It now picks a plan slice by name.
