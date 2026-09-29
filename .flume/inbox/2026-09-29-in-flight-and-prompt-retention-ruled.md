# Ruled: what in-flight counts, and what bounds rendered-prompts

- *What the number means* — (a): row 7 now states the count as agents started
  this run with no usage row yet, a fact about the total, never liveness. The
  shipped derivation stands; no code moves for this half.
- *What bounds `rendered-prompts/`* — a prompt is kept while a retained
  verdict row names it as `promptPath`, and never trimmed inside a live run's
  window (`spec/prompt.md`, *The rendered prompt is persisted before the agent
  runs*). This replaces "Retention is the operator's". The bound derives from
  the verdict history's; no new retention constant.
