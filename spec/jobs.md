# The runtime ignore set

The runtime owns a set of ignore lines for every state root it writes into.
This page governs that set and nothing else.

This file keeps its name while any comment or test in the sweep domain still
cites it: the citation pin resolves a page name against the working tree, so
renaming it before its citations move turns a green pin red for a file that
merely changed address. The commit that removes the last citation renames
this page and is the one that may.

## Runtime ignores

`RUNTIME_IGNORES` is the runtime-owned set merged into a state root's
`.gitignore` at every `loop` start, under the tip claim, so a fresh adopter
never commits a tick artifact because a line was missing from the repo's own
ignore file:

```
awake/
prior-attempts/
rendered-prompts/
worktrees/
node_modules/
loop.pid
tick-verdict/
tick-verdicts.jsonl
stop
merging/
```

- `node_modules/` stays even though no link is planted: it is harmless and keeps stray
  artifacts out of the baseline commit.
- A declared `Chain.friction` dir joins the set (normalized to forward slashes and a single
  trailing slash) — the friction channel is gitignored by machinery, not by per-repo habit.
  The declaration itself lives in `spec/chain.md`.
- Merge semantics: create the file if absent, otherwise append only the entries that are
  missing. Seed-authored lines and their order are preserved verbatim. Idempotent.
- The runtime owns its own layout, and only that. A chain-convention directory under the
  state root is its chain's to ignore — the harness package writes its own at adoption
  (`spec/harness.md`, *The runtime ignore set*), and a line added after adoption rides
  the release's migration note.

## The checkout is the unit of isolation

One state root per checkout, and a repository running several efforts at once
gives each one a checkout of its own (`git worktree add` — the operator's act,
never the engine's). The engine partitions no state below the checkout: it
mints no per-effort namespace, seeds no second root, and offers no selector
that retargets one. Two efforts that share a checkout share its tip, and the
tip claim serializes them whatever their files are called, so a partition
under one checkout buys separate files and no separate execution.

**Why:** everything the engine keys by is already the checkout's — the tip a
claim is taken on, the branch a worktree is minted from, the install a setup
provisions, the tree a gate reads. A second axis beneath it names the same
work twice and separates none of it.
