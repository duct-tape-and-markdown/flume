# spec/harness.md now understates the package in two sections

`contractTouching` is a seventh package entry-extension field, and the
default handoff now writes the stop flag. Two `spec/harness.md` sections read
as current while naming less than the package does:

- *The entry extension* enumerates six fields. A reader takes that list as
  closed; it is now those six plus one the section does not name.
- *The default `handoff`* says it "Reads the engine's reported pickable set
  and no-commit facts" — no longer only a reader. It writes `<flumeDir>/stop`
  after a marked ship: the package's first disk write on the handoff path.

Both are the human's to edit. `spec/loop.md`, *One tick is one fresh
process*, sanctions the mechanism, so the drift is in harness.md alone.

Also: this repo's `.flume/chain.ts` declares no handoff override, so the stop
is live for flume's own loop the moment plan marks an entry. Nothing marks
one yet — when plan sets the flag is the remaining half.
