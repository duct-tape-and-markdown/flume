---
paths:
  - "spec/**"
---

# Spec writing

What a sentence in `spec/*.md` may say. `spec-plan-build.md` says who writes
the spec; this page says what belongs in it once they do. Citable: a `per`
into one of these sections is how a spec-shape defect becomes an entry.

## A claim names behavior, never location

The spec states what flume *is*: what a tick does, what a verb refuses, what
a field means, what lands on disk. A sentence may name:

- **Behavior** — an outcome, a refusal, an exit code, an ordering.
- **Public surface** — an export of `src/index.ts`; a field or hook of
  `Chain`, `Phase`, `FlumeApi`, `TickContext`, `TickResult`, `GateContext`,
  `ShipContext`, `PendingEntry`; a CLI verb, flag, or environment variable.
- **Engine-owned layout on disk** — `awake/`, `pending.json`, the verdict
  files, `prior-attempts/`. Where state lives is contract; a chain reads it.

A sentence may not name:

- A `src/` file path, or a line number. Where a symbol lives is layout, and
  layout is build's lane.
- An internal helper's **home**, or the call order between internal
  functions. A qualified name — `Type.member`, a path-and-symbol pair —
  claims where a symbol lives, and homes are build's lane; the next
  extraction falsifies it. A bare name is shorthand for the behavior that
  symbol produces and survives any move that keeps the name, so it may
  stand. If the sentence needs the home to make sense, it is describing the
  implementation, and the claim wants restating as the behavior the
  implementation produces.
- A test title or a fixture. Tests pin the spec; the spec does not cite them.

**The test:** could build move, rename, or restructure this without changing
observable behavior? Then it is layout, and the sentence is a copy that the
next extraction makes false.

**Why:** a path in prose reads as authoritative and rots on every move; a
public name is the contract build is held to and stays true across moves.

## One truth, in the present tense

The corpus states current truth and the ship target in one voice. A section
that no longer matches `src/` is a defect in one of them, and derive decides
which (`CLAUDE.md`, *Source of truth*).

- No eras or windows ("for the v0.N line", "until the migration"). State the
  condition that would change the rule (`engineering.md`, *Narration is the
  ladder's bottom rung*).
- No incident narrative. "Restored by hand after…", "measured on the 0.N
  cut" — the story lives in the commit that introduced the sentence; the
  spec keeps the rule the story produced.
- No ledgers. A section is not a changelog of itself.

## The spec does not restate a sibling

A value another artifact owns is pointed at, never enumerated
(`engineering.md`, *Derived state is computed, never restated*): the
`package.json` allowlist, a chain's declarations, a rule page's directive,
a tool's documented behavior. The spec says the rule the artifact must
satisfy; the artifact holds the value.

## A heading is an identifier

`per.section` is the exact heading text, and the `per cites resolve` gate
refuses a queue whose cite does not resolve or names a text the file heads
twice (`spec/harness.md`, *The cite resolver*) — so the duplicate half is
the gate's, not the author's. What stays the author's: renaming or splitting
a heading re-homes every entry and question that cites it, and no gate reads
those surfaces — do it, but in the same commit sweep them, and say so in the
body.

One topic per section, sized so a build tick can read it whole as the
entry's *why*.

## Every spec edit is directed, and says so

Humans author; an interactive session edits under explicit direction and
names that in the commit body; phases never touch it
(`spec-plan-build.md`). A session that finds a gap challenges it
(`collaboration.md`) — it does not fill it and move on.

## What holds this page above prose

- `per cites resolve` — headings resolve, at every plan commit.
- Everything else here is held by its authors. `spec/` is edited by a human,
  or by an interactive session under direction, and the editor reads this
  page. That is harness governance, not engine work: no suite pins it and no
  sweep reads it (`engineering.md`, *Narration is the ladder's bottom rung*).
