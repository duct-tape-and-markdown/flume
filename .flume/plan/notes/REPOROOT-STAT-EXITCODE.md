# Five hand-copied stat→EX_IOERR maps in cli.ts

Shipped as written. Mapping the fifth one made the shape visible:
`src/cli.ts` carries five literal copies of

    console.error(`[flume] <where>: ... failed to stat: ${err instanceof
      Error ? err.message : String(err)}`); return EX_IOERR;

(bay discovery, the `--job` state-root guard, `loop.pid`, the stop flag,
the tip claim), plus a sixth near-copy for the friction `readdir`. Each is
the same decode of the same `existsLoud` contract, re-spelled by hand; a
probe added tomorrow inherits nothing and can silently pick a different
code or drop the `[flume]` prefix. Reads as `engineering.md`, *The fix
lands at the mechanism* — not correctness-adjacent, the five agree today.
A helper beside `EX_IOERR` (label in, code out) would collapse them; that
is plan's shape call, not a build tick's to take on the side.

Also noted, no action: `".flume"` is a bare literal in
`cliJobResolution.ts`, `job.ts`, `Dispatcher.ts`, `loopSupervisor.ts` —
no shared constant. This refusal's message avoids spelling it again and
lets the stat error carry the path.
