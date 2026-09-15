# The forge-frame fixtures were one shape where the forge writes two

Shipped as written: `framing(job)` in `harness/ci.ts` keys the strip on
`CiLane.job` and makes the runner stamp optional, so unstamped lines shed
their frame and framed-empty lines drop before the budget is counted.

What plan may want: the gap was invisible to `tests/harnessCi.test.ts`
because every fixture went through one helper (`framed`), which always
stamped. The suite drives the real reader over a real spawn, but the forge's
*output vocabulary* is hand-authored here — a real `--log-failed` carries
both stamped and unstamped lines on one job, and only run 35008214078 said
so. That is the residual half of `engineering.md`, *A seam gate reads what
the real writer wrote*: consumer real, producer the tester. No captured-
fixture mechanism exists in this repo, so I did not invent one — I added
`unstamped` beside `framed`, and both shapes are now fixture vocabulary. The
fork for plan: whether a recorded real forge log belongs in the tree.

`shed` still runs before `tail`, unchanged and deliberate.
