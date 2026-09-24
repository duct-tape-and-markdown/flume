# Which nesting depth does the authoring page owe?

**Section:** `.claude/rules/engineering.md`, *Narration is the ladder's bottom
rung* — a page under `docs/` that states what a shipped interface does "may be
pinned for what it says against the interface it describes". The pin exists.
The question is how deep it reaches.

Raised by the note the build tick left under
`THE-AUTHORING-PAGE-NAMES-WHAT-AGENTS-DECIDES`, and verified against the
shipped pin this drain.

## What the pin holds, and what it does not

`declaredFields()` (`tests/harnessDeclaration.test.ts:587`) is
`Object.keys(DeclarationSchema.shape)` — **top-level keys alone** — and
`fieldsMissingFrom` asks only whether the page's listing backticks each of
those names. So:

- Nothing red while `agents` carried four undocumented subfields (`model`,
  `extraArgs`, `contextWindow`, `inheritUserMcp`); the shipped fix
  (`07480a0f`) was a hand edit, and nothing reds if a fifth lands or one is
  renamed.
- The same hole covers `setup`, `supervisor`, `ci` and `fence`, whose
  subfields `docs/CHAIN-AUTHORING.md` also spells by hand.
- The schema *is* reachable one level down — two sibling cases already read
  `DeclarationSchema.shape.supervisor.unwrap().shape` (`:237`, `:287`) and
  `…ci.unwrap().element.shape` (`:450`) as their own vacuity guards. So the
  instrument exists; what is undecided is what the page owes.

## The fork

1. **Every leaf of every nested object.** Mechanical and total: walk the
   schema, require a backticked name per leaf. Cost: the page becomes a
   schema dump — `fence`'s keys are phase names a consumer declares, not
   fields the package ships, so the walk would demand the page name a
   consumer's own phases. A pin that forces prose nobody would write by hand
   is the wrong rung.
2. **One level under each top-level field.** The depth the note's own fix
   took, and the depth the sibling vacuity guards already reach. Cheap to
   state, cheap to satisfy, and it catches the case that just got past —
   a subfield added under `agents`. Cost: a two-level-deep addition still
   slips, and "one level" is a number with no reason behind it.
   **Recommended**, with the reason in (3) as its actual justification.
3. **Only the fields whose shape a consumer authors by hand.** The page is
   the surface a chain author reads before the hover text, so what it owes is
   what an author must type. `agents.<phase>.model` is typed by hand;
   `fence.<phase>` takes a consumer's own phase names and has no leaf set to
   pin. Cost: "authored by hand" is not read off the schema — it would want a
   marker beside the fields, which is a schema change to serve a doc pin.

## Why this is not an entry

The mechanical half is ready either way — the walk is three lines against
shapes the file already unwraps. What is not ruled is which of the three the
page owes, and that is a statement about the authoring page's contract, which
lives in the human's lane (`.claude/rules/spec-plan-build.md`). The
mechanical half files against whichever sentence the ruling writes.
