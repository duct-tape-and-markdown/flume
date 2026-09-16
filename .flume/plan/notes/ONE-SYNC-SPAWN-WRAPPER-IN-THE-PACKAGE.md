# The fold had a fourth site, and the shim retry widened

`harness/exec.ts` now holds the sync spawn, the 64 MiB bound and the
detail fold. Three judgements worth a look:

- The fold was spelled in **four** modules, not three: `harness/init.ts:505`
  folds a JSON.parse failure the same way, so it took the shared one too. A
  parse error carries no stderr, so its arm is unchanged.
- `cursorWindow.ts` and `cli.ts` adopting it is not quite behaviour-free: the
  shared fold prefers a failure's stderr over the Error message, where before
  they read the message only. For a window over a git that refused, that is
  git's own sentence rather than the same sentence under `Command failed: git
  ...`. The refusal case stays green because it asserts git's line, not the
  frame. Flagging it as the one observable delta in an entry called
  behaviour-free.
- One wrapper means `git()` and `branchAt()` now carry the win32 shim retry
  they did not before. Inert off win32 and inert for a real `.exe`; the
  alternative was a per-caller "is my binary shimmed" decision, the shape the
  entry filed against.
