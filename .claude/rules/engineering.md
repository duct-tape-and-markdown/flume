# Engineering shape

How code enters this repository — the form standard plan derives against and
build ships to. `engine-boundary.md` governs *where* a change belongs; this
page governs *what shape it takes* once it belongs here.

This page is citable: a `per` into one of its sections is how a shape defect
becomes a pending entry.

## Narration is the ladder's bottom rung

Every check lives at the most deterministic layer that can express it — a
**type**, then a **test or pin**, then a **gate**, and only at the bottom,
**prose** (a doc comment, a rule, a prompt paragraph, a PROTOCOL line).

- Prose is where intent lives **while nothing mechanical can hold it yet**.
  It is a queue for the ladder, never an archive beside it.
- When a property gains its type, pin, or gate, the prose that hand-held it
  **shrinks to a pointer in the promoting commit**. Prose asserting a property
  a test now pins is residue fileable against this section.
- A directive repeated in a prompt *and* a rule is drift: the rule is the
  home, the prompt points at it.
- **Narration that anticipates its own obsolescence names both the trigger
  and the actor that retires it.** "Unpin when X", "revisit after Y", "for
  the v0.N line" — each is a decision carrying an expiry predicate. A
  checkable predicate belongs a rung up: a pin, a gate, or a named sweep
  lens. An uncheckable one names, in the prose itself, who retires it and in
  which commit. An unowned trigger is how a scoped decision outlives its
  scope silently, in a form that still reads as current.
- **Prefer the condition to the era.** Prose scoped to a window that closes
  ("for the current line", "until the migration") goes stale the moment the
  window does, and nothing re-reads it. State the condition that would
  change the decision, so a sweep can evaluate it.

**Why:** a defence that lives only in prose is one forgetful tick from
being no defence at all; leaving it there when a rung above is available is
a choice to keep it fragile.

## Derived state is computed, never restated beside its source

A value computable from existing state enters the tree as a computation,
never a second stored copy kept in sync by discipline. Two copies of one
truth is a bug class no compiler checks, and the copy always wins the
argument it should lose — it reads as authoritative while being stale.

- In code: a field derivable from other fields is a getter, not storage.
  Caching a derivation is the sanctioned exception, taken for a measured
  cost, with one home and one invalidation.
- **In artifacts, the same bar.** A tick-written file restating what
  another on-disk artifact already holds — a queue listing beside
  `pending.json`, a question listing beside `open-questions.md`, a HEAD sha
  beside git — is the same defect wearing prose. The artifact that owns the
  fact is the only one that states it; everything else points.
- The test is ownership, not convenience: if regenerating the copy from its
  source would be mechanical, the copy should not exist.

**Why:** these files are re-injected verbatim into every tick, so a restated
fact is both a per-tick token tax and a second thing that can go stale
against the source it paraphrases.

## Loud or nothing

No path silently degrades, reconciles, or **proceeds over an unresolved
input**. A failure the harness can detect is an error at the point of
detection, not a marker downstream consumers must remember to inspect.

- A substituted placeholder standing in for content that failed to resolve is
  a silent degradation unless something downstream **refuses** on it.
- A degraded-but-proceeding path is declared and cited at the site, with the
  refusal that bounds it named — never left looking like an accident.

**Why:** a degraded input produces a confident wrong answer, which costs more
than the failure it was avoiding.

## A green verdict is proven non-vacuous

A judge whose input set collapses to zero keeps passing. Green over nothing
is the failure mode that hides longest.

- A **vacuity pin rides every judge test**: assert the judged set was
  populated — `n > 0` of the thing the test exists to judge — *before*
  asserting the verdict. A test that passes over zero of its subject is not a
  test, and is residue fileable against this section.
- A gate whose selection may legitimately be empty asserts the empty case
  **explicitly**, in its own test. Vacuous-by-design is spelled, never
  inherited.

## A seam gate reads what the real writer wrote

A check whose claim is "the two sides of a seam agree" proves nothing when
both sides come from the same hand. Comparing a writer against its own prior
output pins self-agreement; driving a reader over hand-authored fixtures
re-authors the writer's vocabulary by the tester's hand. Either way a
one-sided change ships green.

- An **agreement gate drives the real producer's output through the real
  consumer** — the actual writer runs and the actual reader decodes what it
  wrote, however much cheaper a hermetic fixture would be.
- Standing instances in this repo: whatever renders a schema for a prompt
  against whatever enforces that schema at parse time; whatever declares a
  fence against whatever enforces it; a changelog against the diff it
  describes.
- **The scope is agreement claims only.** Refusal and shape tests keep their
  hand-authored input — a real writer cannot produce the malformed input a
  reader's refusal is tested on.

## A fix ships the test that would have caught it

Every defect fix includes a test that **fails on the pre-fix tree** — a
platform fix with the input that reproduced it, a seam fix with its
agreement case, a false green with its real assertion. The entry's `tests[]`
names it and the commit body says what it pins.

- A fix derived from a downstream report does not ship until the report's
  **repro is reduced to a case this suite runs**. A fix aimed at a described
  symptom instead of a reproduced one is a guess.
- A fix whose regression genuinely cannot be pinned decidably says so out
  loud in the commit body — the named exception, never the default.

## The fix lands at the mechanism

A special case layered on shared infrastructure — a tool name hardcoded
inside a generic helper, a branch on one caller threaded through shared
code — is the signature of a change pitched too shallow. The preferred fix
generalizes the mechanism until the case stops being special.

- A branch on a *specific instance* inside code that is otherwise generic
  over its type is residue fileable against this section.
- Detection a sibling surface already performs is **shared, never
  re-derived** beside it.
- A divergence that genuinely is the right depth is declared and cited at the
  site.

## An export earns its consumer

Public surface with no consumer is residue: an export born as scaffolding
outlives its scaffold and becomes API someone must excavate later.

- An entry in `src/index.ts`, or any widened visibility, needs a caller
  outside its own module (a test counts) **or** its place in the package's
  public surface as declared API.
- An absence verdict never rests on a bare text search. Confirm a
  zero-consumer or dead-symbol finding with LSP references
  (`code-navigation.md`), never a plain no-hits.
