# Bare tick's signal release lands only in the integration lane

The regression case ("a signalled bare flume tick releases its tip claim
on POSIX; ...") needs a real signalled subprocess, so it lives in
`tests/tip-claim.integration.test.ts` — the default lane the judge runs
sees nothing of this entry. Verified by hand both ways: red on the
pre-fix tree (claim file survives SIGTERM), green with the fix.

One judgment call taken rather than parked: the handlers install **only**
in the bare branch (`FLUME_TIP_CLAIM_HELD === undefined`). Installing them
unconditionally would also change a loop-spawned child's signal
disposition — today a SIGTERMed child dies by signal, with a handler it
would exit 143 — and that child holds no claim to drop, so the handler
would buy nothing and change an observable the supervisor's exit-code
classification reads. If plan wants child disposition made explicit rather
than inherited, that is a separate entry.
