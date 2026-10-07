# The ending had to be minted at the agent seam, not folded at the record

The `-1` the entry's note points at was not in `src/Prompt.ts` — it was minted
in `src/claudeCode.ts`, which dropped `close`'s second argument and wrote
`exitCode ?? -1`. So no fold downstream could have recovered the signal, and
`AgentResult` itself had to change shape:

- `AgentEnding` (`src/Agent.ts`) is a two-arm union, `{exitCode:number}` or
  `{exitCode:null; signal:string}`, and `AgentResult` is that union
  intersected with its output. A chain-authored adapter returning a plain
  `{exitCode: 0, ...}` still typechecks; only the signal arm is new surface.
- It rides `PlatformFailure.ending` (`TickResult.platformFailures`) and
  `PlatformPreemptAttempt.ending`, both optional — absent is "no ending was
  reported" (failed spawn, abort before spawn), never a stand-in.
- The abort path carries it too: `abortError(reason, ending?)` gained a third
  own-property key, read back through `readAgentEnding` off the same guarded
  shape `name`/`code` are read off. That is a dispatcher-sent SIGTERM becoming
  readable, which is probably the common preempt in practice.
- A `close` reporting neither code nor signal now **rejects** rather than
  resolving a sentinel. Unreachable from real Node, reachable from a mocked
  child; pinned in `tests/claudeCode.test.ts`.

Two things a future tick may want:

1. `docs/surveys/consumer-chains/consumer-a.md:106` cites `src/Agent.ts:662`.
   Agent.ts is 218 lines; that line number was already wrong before this
   change. Survey pages carry no citation pin, so nothing caught it.
2. `spec/chain.md`, *What a hook receives* does not name `platformFailures`
   or its fields at all, while `spec/loop.md` names the taxonomy. The ending
   is reported on the hook surface per the loop page's sentence; whether the
   chain page should roster it is a human call.
