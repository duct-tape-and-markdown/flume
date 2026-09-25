# The run-level conclusion the lane reader asks for and drops

Shipped: `CiRunEvidence` (`harness/ci.ts`) carries the jobs invocation and
the declared job's raw conclusion beside branch and run, and `renderRun`
(`harness/ciLane.ts`) states both under every run-bearing arm — failing,
green, and the unread a refused log degraded to.

Observed while there, not filed: `RunSchema.conclusion` (`harness/ci.ts`) is
asked for in `RUN_FIELDS` and parsed off `run list`, and nothing reads it —
the verdict is the *job's* conclusion, which the second call answers. Dead
plumbing by the sweep's lens: the reader pays a field in the forge's argv
for an answer it drops, and a reader arriving later reads the run-level word
as the one behind the verdict. Either the field leaves `RunSchema`, or — if
a run whose declared job passed inside a run the forge cancelled is a
divergence worth stating — it joins the evidence this entry added. The spec
names the job conclusion alone (`spec/harness.md`, *CI lanes as a findings
source*), so the former is the plain read and the latter wants a ruling.

One invocation is reported, not two: the `run view <id> --json jobs` call,
because that is the call whose answer chose the verdict. The `run list` call
that chose *which* run is evidenced by the run id, its created instant and
the branch the block already names — which is the staleness fork's ground
(fork 2 of the same record), and if that fork wants the list argv itself,
`invocation` (`harness/ci.ts`) is now the one spelling to quote it by.
