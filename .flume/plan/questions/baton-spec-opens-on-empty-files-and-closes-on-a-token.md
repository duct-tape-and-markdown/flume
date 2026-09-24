# `spec/loop.md` says the baton is empty files, then says a wake writes a token

`spec/loop.md`, *Baton — presence wakes, absence hibernates* states both halves
of a contradiction now that `A-WAKE-MID-TICK-CARRIES-A-TOKEN` has shipped:

- opening paragraph: "it is a directory of empty files: `<flumeDir>/awake/<phase>`"
- third bullet: "A wake writes a fresh token into the flag; a tick reads the
  token at start and sleeps its phase only while the flag still carries that
  token."

A flag is no longer empty. The opening sentence is the one a reader hits first,
so the stale half is the one that reads as authoritative.

**Recommendation, not a fork.** The token is the shipped mechanism and the
bullet describes it correctly; the opening sentence is what is behind. Striking
"empty" is the whole edit — "a directory of files: `<flumeDir>/awake/<phase>`",
with presence still the wake and the token's job left to the bullet that already
states it.

`spec/` is the human's surface, so no phase can make this edit.

Nothing else in the tree asserted emptiness: `docs/CLI.md`'s "empty file" lines
are the *stop* flag, not the baton, and every other baton reader is
presence-only (checked this tick).
