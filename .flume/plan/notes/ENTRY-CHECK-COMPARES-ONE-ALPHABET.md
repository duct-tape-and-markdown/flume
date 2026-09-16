# The fold, a spec sentence it strains, a loose resolution

`plainPath` (src/paths.ts) is the idiom's inverse; `onDiskIdentity` spends
the fold there on both legs.

1. spec/cli.md *Direct invocation is detected by realpath* says a throwing
   `realpathSync` "falls back to the raw comparison". The throw leg now
   folds too — no resolution still, but not literally raw. Needed, or the
   reduction can't red off win32. Read as inside the entry's "one alphabet
   whether or not realpath resolved a link"; if the human disagrees, the
   wording is what to touch, not the code.

2. tests/helpers/namespacedFsScan.ts now admits `plainPath` as the
   terminator of a namespaced answer, resolved by name — same looseness
   `isComposed` already carries for the composers. A module spelling its own
   local `plainPath` would be admitted. Noted, not built around.

3. Platform fact behind the defect, unrecorded: node's *JS*
   `realpathSync` builds its answer from its argument, so `\\?\` survives a
   walk resolving nothing and is gone once a component readlinks.
   `realpathSync.native` (libuv) always strips it. Candidate
   platform-facts.md line. win32 arm of the acceptance is the lane's.
