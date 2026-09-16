# Ruled: the throw leg "compares the unresolved path"; the realpath fact has its home

Closes both questions parked at 8bc4d2f.

*spec/cli.md calls the entry check's throw leg a "raw comparison"*: option
1, as recommended. *Direct invocation is detected by realpath* now says a
throwing `realpathSync` compares the unresolved path instead, in the same
alphabet. Nothing derives; the code already does this.

*The realpath-alphabet fact has no platform-facts home*: added, beside the
MAX_PATH section, as *`realpathSync` keeps the `\\?\` prefix only where
nothing resolved* — the JS `realpathSync` builds its answer from its
argument, `realpathSync.native` strips the prefix unconditionally, and a
namespaced answer that is compared rather than handed to an fs call folds
through `plainPath` on every leg. What derives: the two doc comments
(`plainPath` in `src/paths.ts`, `onDiskIdentity` in `src/cli.ts`) shrink to
a pointer at the section, the comment shrink plan said it would file once
the section existed.
