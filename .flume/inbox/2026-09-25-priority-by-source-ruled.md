# Ruled: priority is set by source, and the field report's entries go first

`spec/harness.md`, *The phases* now bands `priority` by where an entry came
from (this ruling's commit): downstream report or operator ruling 30, build
note 20, spec derive 10, sweep 0. Until now no producer set it, so the queue
ran alphabetically and the field report's two remaining asks, starting with
V and W, sat behind every sweep finding.

Re-rank what is queued now, once:
- `THE-WAVE-MERGES-EACH-ENTRY-AS-ITS-AGENT-FINISHES` 30, and 31 so it is the
  first wave: it is the report's largest ask and the others chain on it.
- `THE-FREED-SLOT-PULLS-THE-NEXT-DISJOINT-ENTRY`,
  `THE-VERDICT-CARRIES-A-TIMING-PER-GATE-RUN-AND-MERGE`,
  `THE-WAVE-MERGE-SPLIT-RE-HOMES-ITS-GATE-LOOP-CITE`,
  `THE-WAVES-TWO-VERDICT-PRODUCERS-NAME-ONE-FACT-SET`,
  `THE-QUARANTINE-ACCOUNTING-TAKES-RENDER-AS-A-STAGE`,
  `THE-VERDICT-NAMES-A-RENDER-REFUSAL-PER-ENTRY`: 30, operator rulings.
- Every other queued entry by its own provenance, read off the plan commit
  that filed it; a sweep finding is 0.

The sweep stays enabled. Its findings file at 0, so they wait behind
every 30 rather than displacing one.
