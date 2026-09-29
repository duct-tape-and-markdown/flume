# The constructor mkdir is the seam every verb's 74 row is proven through

Measured on this tree: moved the mkdir to `wake`, gave `awake()` an ENOENT
arm, changed nothing else, then ran every verb over the denial fixture
`tests/cliHelp.test.ts` already owns (CLI-VERB-PAGES-NAME-THE-STATE-ROOT-
WRITE-REFUSAL: a plain file at `awake/`, a directory at `stop`):

  status 1, tick 1, sleep 1 — raw ENOTDIR stacks
  loop 1 — "stop flag present"
  wake 74, stop 74 — the write refusal
  render 0, log 0, check 0, friction 0

Today all seven baton verbs answer 74, because that one mkdir is the first
write every one of them makes. Exit 1 on a raw stack is what `src/cli.ts`'s
root-stat seam calls the one exit these verbs may not take, and `status` has
no 1 row at all. The two doc edits the entry names are the tail; this is the
head, and it needs rulings nobody has made:

1. Does a *read* under the root get a classified refusal — a sibling of
   `StateRootWriteError`, one arm in `main()` — or does one class cover
   access? (`awake()` is what `status`, `tick` and `loop` die on.)
2. Does `Baton.sleep`'s unlink go through the write refusal? After the
   narrowing it is the only thing left in that verb that can fail.
3. Which `74` rows state it afterwards. `render` clearly drops it. `loop`
   keeps it (its supervisor reads the baton) but the fixture can no longer
   drive it there: the stop-flag denial `stop` needs refuses `loop` first at
   exit 1. So the gate's one pass stops reaching every verb's first access —
   two denial passes, or a weakened equality.

Also moving with it: `holdsState`'s doc (`src/cliStateDirs.ts`) and
`docs/CLI.md:23` both cite "a read-only `flume status` creates an empty
`awake/`" as the reason a probed directory is not state; the second-root
arithmetic needs a different example.

`src/stateRootAccess.ts` in this entry's `observedFiles` is from the
merge-failed attempt (1f36abcd) — that tick took fork 1. Its branch is gone.
