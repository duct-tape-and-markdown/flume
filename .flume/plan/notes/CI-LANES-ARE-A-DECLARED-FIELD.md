# `ci` shipped as shape; "lane" now names two things

Shipped: `ci?: [{ name, workflow, job }, ...]`, non-empty, lane names unique
— the slice keys findings by lane name + title, so two lanes sharing a name
would file as one; refused at load, not silently merged.

For the consuming entry (INBOX-SLICE-RENDERS-THE-DECLARED-CI-LANE):

- **`lane` is overloaded in `harness/` now.** `Runner.lanes` partitions the
  *test suite* and the judge reads it; a `ci` entry partitions *CI* and the
  inbox slice reads it. The doc comment says so, but that entry wants a
  distinct exported name — the schema's `CiLane` shadows nothing today only
  because nothing is exported.
- **No new export here.** `CiLane` stays module-local: no consumer outside
  the schema yet (`engineering.md`, *An export earns its consumer*).
- This repo's `.flume/declaration.ts` still declares no `ci:` line — outside
  build's fence, a `chore(flume)` edit. Until it lands, tests alone exercise
  the field.

Corrected in passing: `DeclarationSchema`'s doc comment counted "the eleven
in the table plus two in prose", stale against a 13-row spec table. It
points at the table now instead of restating a count.
