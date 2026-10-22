# The gate deadline reaches the engine's doors, and kills a child rather than a tree

**The entry's "tree kill" shipped as a child kill, measured.** Node's
`execFile` composes its own spawn options and forwards no `detached` (probed:
the child's pgid is the parent's), so a gate child leads no process group and
a group signal over it would ESRCH. A grandchild of a gate's command is
reparented and survives. Reaching it needs a capturing door built on
`spawnProcessTree`, which would re-implement node's `maxBuffer` behaviour that
`platform-facts.md` pins as node's — out of this entry's depth. `SignalReach`
(`src/processTree.ts`) is where a wider reach plugs in if one is ever wanted.

**The refusal loses the gate invocation, not the spawn.** Two reasons, both
load-bearing: `execFile` resolves on the child's `close`, so a grandchild
holding the inherited stdout keeps that promise pending past the kill — only
racing the invocation makes the deadline arrive at the stated ms; and
`shellGate` catches its command's failure as an ordinary verdict, so a refusal
riding the spawn alone would be absorbed and reported green.

**Two gaps I did not file** (both outside the acceptance):

- A **chain-authored** gate spawning by hand gets no bound and cannot read the
  deadline — `GateContext` does not report it. Candidate entry per
  `engineering.md`, *A fact the engine holds is reported, never rediscovered*.
- `captureSync` (`harness/exec.ts`) takes none: a blocking spawn cannot be
  raced. Only the plan window builders use it today; a runner reaching for it
  inside a gate would be uncapped.

**No `spawnCaps` scan arm**, though plan predicted one: that verdict needs
exemptions (the agent spawn has its own bound, the loop's tick child is no
gate child), and a list excuses exactly the sites it names — the reason
`scanSpawnStdin` declares none.

`spec/chain.md`, *Supervisor policy is a chain-overridable default* enumerates
the block and does not name `gateTimeoutMs`.
