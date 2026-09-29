# The preempt class reaches the verdict; the roster is the sibling's

`PlatformFailure` (`src/tickVerdict.ts`) is deliberately **not** a
`StageFailureEntry`: the wall a preempt names is the host's, so the record
carries no `tag`/`quarantineKey` at all rather than two fields every producer
must remember to leave off. Both new tests assert that by
`Object.keys(...)`, so a blame half added later reds them.

For THE-FAILURE-ACCOUNTING-TAKES-PLATFORM-AS-A-FIFTH-STAGE, which reads this
list: `FAILURE_STAGES` and the `stageLists` fold (`src/loopSupervisor.ts`) are
untouched here, as that entry's scope says. Two facts it will want:

- `stageLists` is typed `Record<FailureStage, readonly (StageFailureEntry &
  {signature, message})[]>`. A `PlatformFailure[]` is assignable to that arm
  (both blame fields optional-undefined), so adding `platform:
  verdict?.platformFailures ?? []` needs no widening, and the quarantine
  loop's `if (!f.tag) continue` already routes a preempt to the backstop
  alone.
- `FAILURE_STAGES`' doc says "every stage a **per-entry** failure record can
  come from ... the four the tick verdict carries in separate lists". That
  stayed true rather than going stale — platform is not per-entry — but the
  sentence is the one to rewrite when the roster gains the fifth member, or
  it will read as a count.

Test-surface note: `fanoutAgent` (`tests/Dispatcher.test.ts`) now lets an
action answer with an exit code instead of `void`. That was needed by the
`driveWave` agreement fixture, whose claim is "every fact field
`buildTickVerdict` omits when empty" — a new conditional list there is a
narrower populated set passing as a complete one
(`.claude/rules/engineering.md`, *A seam gate reads what the real writer
wrote*), so the fixture gained a `PREEMPT-WALL` slot rather than a
vacuous-by-design exemption. Priorities in that queue were renumbered 8..1 to
seat it before `DECLINE-ME`.
