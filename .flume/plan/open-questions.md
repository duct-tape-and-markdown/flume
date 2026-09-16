# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## spec/cli.md calls the entry check's throw leg a "raw comparison"; it now folds

**Status:** NEEDS AMENDMENT

`spec/cli.md`, *Direct invocation is detected by realpath*, closes: "a
throwing `realpathSync` falls back to the raw comparison rather than crashing
the import." Since ENTRY-CHECK-COMPARES-ONE-ALPHABET the throw leg is
`plainPath(path)` — still unresolved, but no longer literally raw. The fold is
needed on that leg or the win32 reduction cannot red, so the code is right and
the sentence trails it by one word.

**Options**

1. Reword to what the leg does — e.g. "a throwing `realpathSync` compares the
   unresolved path instead, in the same alphabet, rather than crashing the
   import."
2. Leave it, reading "raw" as "unresolved" and asking the reader to.

**Recommended:** (1). The behavior is settled; only its description trails.

## The realpath-alphabet fact behind the entry check has no platform-facts home

**Status:** NEEDS AMENDMENT

Measured at ENTRY-CHECK-COMPARES-ONE-ALPHABET: node's JS `realpathSync` builds
its answer from the argument it was handed, so `toNamespacedPath`'s `\\?\`
prefix survives a walk that resolved no link and is gone the moment a
component readlinks — two spellings of one file, decided only by how it was
installed. `realpathSync.native` (libuv) strips it unconditionally.

The fact is external, so no test pins it and no type holds it:
`.claude/rules/platform-facts.md` is its home. Today it lives as a doc comment
on `plainPath` (`src/paths.ts`) and a second on `onDiskIdentity`
(`src/cli.ts`) — the copy that page exists to replace. `.claude/rules/**` is
outside build's fence, so plan cannot file this as an entry.

**Recommended:** a human adds the section, beside *Windows MAX_PATH (~260
chars) breaks fs calls with no long component*, whose `toNamespacedPath` idiom
this is the exit from. Plan files the comment shrink as an entry once the
section exists to point at.
