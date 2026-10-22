# A spawned child has no way to fail on its own: stdin left open, no deadline (downstream consumer report, class)

**Kind.** A child the engine awaits can wait forever and report nothing:
its stdin is a live pipe nobody ends, and no deadline bounds it. Any tool
that falls back to reading stdin, or prompts, or wedges, turns into a slot
held silently. `engineering.md`, *Loud or nothing*.

**Members (census of the tree, 2026-10-22).**
- Field instance: a `shell` gate running `prettier --check` with an empty file
  list fell back to stdin; two build slots held ~7h, no log line. Mechanism
  verified: `execFile` gives the child a stdin pipe (a socketpair on linux,
  hence the reported `socket:[…]`) that nothing ends — not, as reported, the
  supervisor's inherited stdin.
- Every async spawn carries it: `execFileWithShimRetry` (`src/spawnShim.ts`)
  and so `shellGate` + the builtin pkg-manager gates, `setup.restore`, the
  default installer, `captureRun` (vitest and script runners); and
  `src/git.ts`'s own `execFile` (a git credential prompt is the same hang).
- The sync door already closes stdin and says why (`captureSync`,
  `harness/exec.ts`): one decision, two answers, between the two halves of
  the spawn mechanism.
- Deadline: `tickTimeoutMs` bounds the agent only; no gate, runner or restore
  run is bounded. The consumer's "stop waits 16+ min on in-flight merges" is
  this class seen from `flume stop` — graceful stop is correct, its latency is
  unbounded because the gate under it is.

**Owning artifact.** The spawn homes and the per-site spawn pin that already
exists for the same family (`tests/spawnCaps.test.ts`, `SHIPPED_SPAWN_HOMES`,
holding `platform-facts.md`, *Node caps a captured child stream*). The cap is
one property every spawn declares; stdin and a deadline are two more of the
same property set. Fix the class there: the homes close stdin and take a
deadline, and the scanner's verdict widens from "declares its cap" to
"declares its cap, its stdin, its deadline", so a new spawn site cannot
reopen it.

**Decision for the human.** The deadline is policy → chain-overridable with
a default (`engine-boundary.md`, *Routing rule*): whether it is one
`supervisor` knob over every gate run or per declared gate, and what a
timed-out gate reports (`blamesSpan: false`? it is the gate's failure, not
the span's).
