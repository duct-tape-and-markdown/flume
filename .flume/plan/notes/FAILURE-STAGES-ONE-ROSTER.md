# The barrel re-export was left off — FAILURE_STAGES has no consumer there

Shipped: `FAILURE_STAGES` in `src/loopSupervisor.ts` with `FailureStage`
derived from it, the supervisor's per-stage fold rekeyed to a
`Record<FailureStage, …>` (so a roster member with no verdict list is a
compile error, not a silently dropped stage), and the three suites driven
off the roster.

Not shipped: the `src/index.ts` re-export the entry predicted. `src/index.ts`
exports nothing from `loopSupervisor` today — not `superviseLoop`, not
`SuperviseResult` — so a package consumer reading `FAILURE_STAGES` off the
barrel has no supervisor surface to spend it on, and the three driven tests
import the module directly. That makes it an export with no consumer outside
its own module (`engineering.md`, *An export earns its consumer*), unlike
`NO_COMMIT_MODES`, which `spec/loop.md` §"The no-commit taxonomy" declares as
engine-exported for a chain to name modes from. If the stage roster should be
chain-facing the same way, that is a spec sentence first, and the barrel
entry follows it — worth a human call rather than a build tick's.
