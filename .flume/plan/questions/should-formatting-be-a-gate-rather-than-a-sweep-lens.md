# Should formatting be a gate on this tree, or stay a sweep-by-eye lens?

From THE-SETUPWORKTREE-WALLS-TEARDOWN-CALL-SITS-IN-ITS-BLOCK's note, which
shipped the last body of the family *a call's arguments indented to the
enclosing function rather than their own block* and declined to decide this.
Re-noted by THE-AGENT-SPEND-FOLD-TAKES-THE-FILE-ITS-NAME-IS's note, which
measured three divergent sites (`src/loopSupervisor.ts:219`,
`src/cliVerdict.ts:375`, `tests/cliVerdict.test.ts:525`) and asked the same
fork; the measurement below is that drain's, and it is two orders of magnitude
larger than three sites.
Re-noted a third time by
THE-VERDICTS-PROVISIONED-TAGS-ARE-READ-AS-A-SET-NOT-A-SEQUENCE's note, from
the other side of the fork: not a shape to catch, but what the absence costs —
`tests/Dispatcher.test.ts` is not prettier-clean on the base, so every diff in
the file build waves touch most carries reformat noise beside the change, and
nothing gates it. That is a cost of (a) the measurement below does not price:
the tree does not drift toward clean on its own.

**What the tree actually is**, verified this tick:

- No formatter. No `.prettierrc`, no `.editorconfig`, no `eslint` config, and
  `package.json` carries no format or lint script. The fence already admits
  `.prettierrc`, `.prettierrc.*` and `package.json`, so build could add the
  config and the dep; it cannot add the gate.
- **The tree is not prettier-clean, and not by a little.** Measured with
  `prettier@3` at its defaults against a scratch copy, no config in the tree:
  **139 of the 191** `.ts` files under `src/`, `harness/` and `tests/` differ,
  and the reformat moves **~22,500 lines** — 481 in `src/`, 285 in `harness/`,
  21,792 in `tests/`. A wider `printWidth` does not rescue it: at `100` the
  diff *grows* to ~28,000, because prettier then re-joins lines this repo
  wrapped by hand. The repo's own lines already sit inside 80 columns
  (p50 = 39, p95 = 78), so the gap is prettier's own wrap/join algorithm over
  long test fixtures and chained `expect` calls, not a width setting to tune.
- The mechanism is already shipped, twice. `.flume/declaration.ts` can declare
  `{ kind: "shell", command: ..., when: "afterCommit" }`
  (`harness/declaredGates.ts`, `constructGate`), and the package's registry
  already ships an `eslintGate` this repo has never opted into
  (`harness/declaredGates.ts`, `registry`). **Nothing is missing but the
  decision** — which is why this is here and not in the queue.
- The family it would retire reads **empty on disk**: the note scanned `src/`,
  `harness/`, `tests/`, `examples/` and `scripts/` for the shape and found one
  hit, a false positive (an indented code block inside a doc comment at
  `src/terminalRender.ts`). So the gate would be buying insurance over zero
  live sites.
- The cost the family did pay: one site survived **three rotations** of
  accepted-debt lines, because the only lens that ever sees this shape is a
  sweep reading code by eye — `engineering.md`'s bottom rung, where a fully
  mechanizable check has no business sitting.

The split matters for who can act. The config, the dep and the tree-wide
reformat are build's fence; the declared gate line is `.flume/**`, outside it,
so it is a `chore(flume):` commit from an interactive session. An entry cannot
carry both halves.

## (a) Leave it. No formatter, and the sweep keeps the lens.

- For: the family is empty, so the gate buys nothing today. A tree-wide
  reformat is a commit that touches nearly every file and makes every
  `git blame` line point at it — a real and permanent cost paid against zero
  standing defects.
- Against: it re-opens the thing that made this a three-rotation family. The
  lens stays on the sweep's attention list forever, and the next body costs
  another rotation to notice and a build tick to fix.

## (b) Prettier, `--check` as a declared shell gate.

Add `prettier` as a dev dep with a config, reformat the tree in one commit,
then declare `{ kind: "shell", command: "pnpm prettier --check ." }` at
`afterCommit`. Retires the lens outright: no agent can land the shape again.

- For: the rung the ladder says this check belongs on. Zero judgment at
  review time, and the sweep stops reading indentation.
- Against: two commits across two fences to land it, and prettier's opinions
  reach far past this family — it will rewrap prose in doc comments, which
  this repo writes densely and deliberately. The reformat diff is the thing to
  look at before agreeing, not after, and it is now measured above: ~22.5k
  lines, 21.8k of them in `tests/`, so almost every test file's `git blame`
  points at the reformat commit. Buying this rung costs a restyle of the
  suite, not a tidy-up of a residue.

## (c) Opt into the `eslintGate` the registry already ships.

One line in `.flume/declaration.ts`, plus — in build's fence — an eslint
config and a `scripts.lint`, which `eslintGate` shells out to
(`src/builtinGates.ts`, it runs `<pm> lint` and is opt-in for exactly that
reason).

- For: cheapest to declare, and buys more than formatting — the unconstructable
  branches and dead-plumbing the sweep also reads by eye have lint rules.
- Against: eslint is not a formatter; it would not have caught this family's
  indentation at all without a stylistic plugin. Answers a different question
  than the note asked, and drags a rule-set curation job in with it.

**My read:** (a) or (b), and the fork is whether you want to look at a
tree-wide prettier diff. (c) is worth its own question — it is about lint
coverage, not about this family — and filing it here would let the cheap
answer settle the expensive one. I did not pick, because the reformat's blast
radius is a taste call on prose you wrote by hand.
