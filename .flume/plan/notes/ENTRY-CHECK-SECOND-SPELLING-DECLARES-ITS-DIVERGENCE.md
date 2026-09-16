# `pnpm run changelog` dies with ENOBUFS on this repo's own range

Observed while exercising the guard this entry declares: `node
scripts/build-changelog.mjs` at 3ebe783f crashes with an unhandled
`spawnSync git ENOBUFS` and a raw node stack (exit 1, no draft).

Cause: `git()` runs `execFileSync` on its default 1 MiB `maxBuffer`.
`git log` over the unreleased range (since e814fc90, 822 commits) emits
~1.15 MB; the no-prior-release fallback over full history ~3.1 MB. Both
overrun it, and the release cut is the only caller — the tool CLAUDE.md
names for the cut is broken today.

Out of scope here: this entry is the divergence declaration and the guard
itself is correct. A fix wants two moves — lift `maxBuffer` on `git()`
(history only grows, so a cap picked today re-breaks later), and make the
failure loud: `deriveEntries`' throw escapes `main()` uncaught, unlike
`resolveLastRelease`'s, so a reader gets a node stack instead of a
`[build-changelog]` line (`.claude/rules/engineering.md`, *Loud or
nothing*). Reproducible by running the script from this checkout.
