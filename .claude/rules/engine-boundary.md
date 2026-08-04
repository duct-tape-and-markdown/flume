# Engine/Implementation Boundary

**The engine ships mechanism, never convention.** `src/` is a generic
harness; a `.flume/` chain (this repo's or any downstream repo's) is an
implementation. Every engine change must pass the
**second-implementation test**: would an unrelated implementation —
different workflow, different stack, different conventions — want
exactly this behavior, or would it want to choose? If it would choose,
the behavior belongs on the chain surface (config, declared schema,
policy knobs), not in the engine.

## Capability vs convention

- A **capability** is machinery with an injection point: the chain
  supplies the value, the engine supplies the enforcement. Fences,
  gates, channel paths, capability-gated pickability, extension
  schemas. Capabilities enable use-cases — they belong in the engine.
- A **convention** is one implementation's choice hardcoded as
  everyone's behavior: a tag grammar beyond mechanical safety, a prose
  cap on a field the engine never reads, a named environment as an enum
  variant, a workflow field in the core entry shape. Conventions do not
  ship in the engine — they live in a chain's declared extension.
- The line between them: the engine validates and interprets **only
  what its mechanics consume**. Enforcing shape on payload it never
  reads is convention-policing.

## Told, not inferred

The engine consumes values it was **given**. It never derives a meaning it
was not given — and a capability whose injection point exists is not a
licence to guess when the chain declined to use it.

Two shapes, one defect:

- **Pattern-matching prose the engine did not author.** A regex over an
  agent's message, a tool's stderr, a commit body. The engine is
  reconstructing a statement instead of reading one.
- **Inferring intent from side effects.** Deciding what a tick *meant* from
  which paths its commit touched, which files it declared, or which globs a
  phase happens to own. The evidence is real; the conclusion drawn from it
  is invented.

**The test:** could the counterparty have said this outright? If yes, the
engine reads that statement or asks the chain to interpret — it does not
rebuild the answer from evidence. If no — an external tool emitting only
English, with no exit code or error code to key on — the divergence is
**declared and cited at the site**, the sanctioned exception rather than the
default.

**Evidence must be durable.** A decision made from a process's stdout is
state the engine is holding, not state on the disk the next tick reads.
Anything that changes what is on disk is decided from what is on disk.

**Why:** an inference is an opinion with no owner. It reads as mechanism, so
nothing re-litigates it, and it silently changes meaning the moment the
counterparty rephrases — a localized error string, a reworded prompt, a
convention the engine never agreed to.

## Routing rule (plan, build, and interactive sessions)

- When triaging a finding, first ask: **is this the engine's
  business?** If a chain could have decided it, route it to chain
  config/docs or park it as a boundary question — do not file an
  engine entry.
- Incident-driven derivation biases toward engine patches, because
  `src/` is the only surface the phases can ship to. Treat that bias as
  the failure mode this rule exists to fence.
- Policy constants (retry counts, quarantine scope, abort thresholds)
  enter the engine only as chain-overridable defaults, never as fixed
  behavior.
- The engine reports **facts** about a tick (commit landed or not,
  which gate failed, which paths violated the fence); chains own the
  **interpretation** (wake conditions, retry policy, what an outcome
  means).

**Why:** flume develops flume. Without this fence, the loop steadily
freezes its own conventions into the engine, and the generic harness
becomes a bespoke tool for its own development.
