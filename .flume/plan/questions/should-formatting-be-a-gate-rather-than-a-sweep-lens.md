# Should formatting be a gate on this tree, or stay a sweep-by-eye lens?

From THE-SETUPWORKTREE-WALLS-TEARDOWN-CALL-SITS-IN-ITS-BLOCK's note, which
shipped the last body of the family *a call's arguments indented to the
enclosing function rather than their own block* and declined to decide this.

**What the tree actually is**, verified this tick:

- No formatter. No `.prettierrc`, no `.editorconfig`, no `eslint` config, and
  `package.json` carries no format or lint script. The fence already admits
  `.prettierrc`, `.prettierrc.*` and `package.json`, so build could add the
  config and the dep; it cannot add the gate.
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
  look at before agreeing, not after.

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
