# The second-root evidence is the bay's contents, not its presence

`spec/jobs.md` says "a checkout whose flume state already names a different
one". Two readings; the tree decides between them.

Bare presence — bay exists, resolved root differs — refuses every documented
relocation: the chain lives at `<repoRoot>/.flume/chain.ts`, so `configDir`
defaults there while `FLUME_DIR` moves state alone, which `spec/cli.md`,
*State-root and config-dir resolution* states as the supported split and four
suites exercise (the relative-FLUME_DIR canonicalization case, both relocating
integration cases, the git-floor warning's relocated root). It would also kill
the README's attach-work-detach dock against any adopted repo.

So the evidence is read one level deeper: the bay is another *state root* when
it holds a runtime-owned name (`STATE_ROOT_NAMES` — a baton, a worktree base,
a verdict log). A bay holding only a chain is this run's config dir. That
matches the question's own wording ("this checkout's other flume state") and
the harm it names (a branch the first root's *tick* holds). All four cases
above stay green; the refusal fires on the reported shape.

Two consequences to weigh: an empty `awake/` left by one `flume status` arms
the refusal, so "has been looked at" reads as "is a root"; and sibling roots
with no bay at all (`.flume-a`, `.flume-b`) are not caught, since discovery
falls back to cwd and there is no flume state to disagree with.

Past the predicted files: `docs/CLI.md`, `README.md` and
`docs/CHAIN-AUTHORING.md` each state the relocation contract and now state its
bound. Both `tests[]` lines live in `tests/cliStateDirs.test.ts` rather than
`tests/cli.test.ts` — the resolution seam's own cases are there, and it kept
this entry off the sibling entry's file.

Still open, as the routing commit said: two linked checkouts share one ref
namespace, so the escape this refusal pushes an operator toward still collides
on a singleton's branch.
