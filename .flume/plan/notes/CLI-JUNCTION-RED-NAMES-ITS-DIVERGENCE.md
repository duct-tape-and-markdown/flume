# The junction red is instrumented, not closed

Shipped: the case asserts `onDiskIdentity(junctioned)` against
`CLI_MODULE_IDENTITY` (new export, `src/cli.ts`), so the next windows lane
prints two paths instead of `false`. The bug is unfixed and unreproducible
here - win32 only.

Root cause, read off node 22 `lib/fs.js` rather than run: JS `realpathSync`
splits the root first and, on win32 alone, lstats it before walking. For
`\\?\C:\...` the root regex reads the leading `\\` as a UNC root, so it
lstats `\\?\C:` and that is no path - throw. Both legs of `onDiskIdentity`
take the unresolved fallback, the junction is never resolved, and the two raw
spellings differ. `realpathSync.native` does not split, and per
`platform-facts.md` it strips the prefix unconditionally, which is the fold
`plainPath` exists to spend.

The candidate fix is one call swap, plus whatever the namespaced-answer scan
says about a native call. Filing it wants a ruling on whether a
non-reproducible platform fix may ship on the lane's red as its repro
(`engineering.md`, *A fix ships the test that would have caught it*).
