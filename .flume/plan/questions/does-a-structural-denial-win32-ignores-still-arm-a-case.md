# A structural denial win32 ignored: does the guidance hold, and how should a case arm its own denial?

`.claude/rules/platform-facts.md`, *`chmod` denies nothing on win32* sends
every denial case to a structural substitute — "a plain file where a directory
is expected, a directory where a file is expected — **which denies on every
host** and survives a root-run test". The five walled-wave cases in
`tests/Dispatcher.test.ts` took that advice: BOOM-B's worktree got a `.git`
gitfile pointing at `gitdir: /flume-no-such-gitdir`, so the tip read would
fatal and the slot leg would throw.

It denied on posix. On win32 it denied nothing — the windows lane's reds show
the arm never fired, and one case's own read of the planted file ENOENT'd
because the un-armed slot's teardown had already removed the directory. So the
page's "denies on every host" now has one measured counter-example, and the
mechanism is unread: git's repository discovery should fatal on a gitfile
whose gitdir is absent, on either host.

`build:` 1f397af0 has already replaced the arming — each case now injects a
`git.revParse` spy scoped to BOOM-B's worktree and pins `tipDenials > 0`, the
arming's own count, rather than reading the planted file back off disk. That
fix is in the tree and unproven on win32: run 36760791228 was made on
5e9da727, which predates it, so the next windows run past 1f397af0 is the
first evidence either way.

Two questions, and the second only matters if the first lands on (a) or (b).

## 1. What does the page say now?

- **(a) Measure it, then state the fact.** Read the win32 lane once for what
  a dangling-gitdir `.git` actually does there, and add the finding to
  `platform-facts.md` as its own section. Cost: a lane read a human has to
  make; nothing here can. Benefit: the page stays a page of measured facts,
  and the next case reaching for a structural denial knows which forms hold.
- **(b) Weaken the claim without measuring.** Change "which denies on every
  host" to something the counter-example survives — a structural denial is
  preferred but not guaranteed, so a case proves its own arm fired. Cost: the
  guidance gets one class weaker for every case, including the many where a
  structural denial does hold. Benefit: no lane read needed, and it is honest
  about what is known today.
- **(c) Leave the page as it reads.** The counter-example is one form of one
  denial and the mechanism is unread; a page of measured facts should not
  take an unmeasured retraction. Cost: the next case takes the same advice
  into the same silent un-arming.

I would take (a) if the lane read is cheap and (b) if it is not — what the
page must not do is keep a claim the tree has already contradicted once while
the correction waits on a measurement nobody has scheduled.

## 2. Is "an arming answers its own denial count" a standing lens?

The defect class the walled-wave cases hit is a vacuity pin read off the
fixture's *own planted side effect* under a path the tick may have torn down:
green where the arming armed, ENOENT where it did not, and never "the wall did
not happen". An arming that reports its own count cannot lie either way — the
corollary the fix used.

This looks like a `posture-sweep.md` standing lens, beside *A negative
assertion over a whole rendered artifact*, which it rhymes with. It is not
filed as one: the build tick that hit it did not sweep for siblings, so the
family has exactly one measured instance, and `posture-sweep.md`, *The pages
are the authority as they read this tick* prices a new lens at every
neighborhood swept after the edit. The fork is whether to sweep for siblings
first (and file the lens only if the family is real) or to ratify it on one
instance because the failure mode is silent.

**Blocking on:** nothing in the queue. Both win32 entries are already gated on
a `win32-build-host` capability the declaration asserts nowhere, so no build
tick reaches this either way.
