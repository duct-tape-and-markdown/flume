# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-07-30 — centercode-platform 0.8 upgrade friction, three findings (jeff pass, routed by operator)

1. **0.7 pin handshake cannot protect its own audience — high.** MIGRATING-0.8 §4 promises a pinned-but-unprovisioned bay is "a hard stop, not a silent fallback to PATH" — but that check is ≥0.7 code, and the guide's audience is by definition a 0.6.x bay whose global shim predates the handshake: it never looks for a local install and runs its own engine against the upgraded chain with no warning. Confirmed empirically (platform upgrade): a 0.6.2 global ran silently against the 0.8.0 bay; only a failing render's stack exposed it. An old engine ignores `Chain.entryExtension` entirely and validates against a schema the chain no longer describes. Corroborated independently from the other side (platform dal-migration branch: "a global ahead of the pin runs the chain under semantics it wasn't written for"). Operator framing for derivation: any engine-side fix ships only to engines that don't need it — the fix class is a **chain-side trip-wire an old engine naturally fails loudly on** (e.g. the chain importing a ≥0.8-only export makes a pre-0.8 engine's chain load die at module resolution), plus correcting the guide's over-promise. This class recurs on every future line (bay ahead of any reachable engine), so fix once, structurally; don't scope it to 0.6→0.8.
2. **pendingGate doc implies static attach; breaks declaration-driven chains — medium.** The gate reads `targetFence.writablePaths` at construction; CHAIN-AUTHORING's "typically passed as the phase value itself" is safe only when the fence is a module-level constant (dogfood shape). A chain whose fence derives from per-job `declaration.json` must not read it at import (`flume job new` loads the chain before the job dir exists) — static `gates: [pendingGate({...})]` makes every job unmountable; platform had to construct inside a `get gates()` accessor. Fix: CHAIN-AUTHORING names the eager capture and shows the lazy-construction pattern.
3. **renderSchemaForPrompt swallows its separator after trailing line comments — low, two independent consumers.** Fields join with ",\n", so a hint ending in a `//` comment swallows its own comma and the rendered PENDING_SCHEMA loses a delimiter — degrading exactly the artifact the declaration exists to keep honest. The dogfood chain hit this during its own migration and worked around it by rewording hints (operator confirmation); platform hit it independently. Two consumers = the engine owns it: place the separator before a hint's trailing line comment (or equivalent) so hint authors can't break the render.
