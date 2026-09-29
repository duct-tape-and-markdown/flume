# Does a hand-built fixture for a record the engine writes mint through the writer's own derivations?

`engineering.md`, *A seam gate reads what the real writer wrote* governs the
**gate**: an agreement claim drives the real producer through the real
consumer. It says nothing about the **fixture** one rung earlier, and
THE-DRAIN-WAKE-LIFTS-WHEN-THE-BUILD-WALL-LIFTS measured what that costs.

## What was measured

Every entry-keyed record fixture in `tests/harnessHandoff.test.ts`
(`entryAnchor`) and `tests/harnessWindows.test.ts` (`record`) was minted with
no `declaredAs` — a shape the real store reads as absent and never hands a
reader (`PriorAttempt.declaredAs`, `src/Prompt.ts:183`). When
`isStandingRefusal` (`harness/standingRefusal.ts:139`) gained the
declaration-key leg, the wake leg's cases were judging records the wall could
never have judged. The two surfaces' agreement case was the only one that
stamped the field, by hand, on top of the helper — so the drift stood green.
Both anchors now derive it through `entryDeclaredKey`, so the fixtures are
fixed; the question is whether the page gains a phrase.

## Why the existing section does not reach it

The section's scope line is explicit: "**The scope is agreement claims
only.** Refusal and shape tests keep their hand-authored input — a real
writer cannot produce the malformed input a reader's refusal is tested on."

These cases are neither. They are **classifier** tests over a fixture
purporting to be a *well-formed* record — not a malformed input tested for
refusal, but a shape the writer would never emit, judged as though it would.
The carve-out excludes them and no phrase includes them.

## The fork

**A.** Add a bullet to *A seam gate reads what the real writer wrote*:
a hand-built fixture standing in for an artifact the engine writes is minted
through the writer's own derivations, so a leg the classifier gains cannot be
judged over records no store could hold.
*For:* one home, and the family is genuinely the same one rung earlier.
*Against:* the section's own scope line says agreement claims only; a fixture
rule is a third thing beside the gate and the carve-out, and the section
would then govern two subjects.

**B.** A standing sweep lens in `posture-sweep.md` instead — "a fixture for
an engine-written artifact, hand-minted". *For:* lenses are where "read every
neighborhood for this shape" lives, and it arms the whole domain without
re-scoping a posture section. *Against:* a lens is procedure, not a standard;
nothing files against a lens the way a `per` cites a section.

**C.** Neither — the shipped fix is the whole of it, and the next instance is
cheap enough to catch by hand. *For:* one measured instance is not a family.
*Against:* it stood green through a real classifier change, which is the
failure mode the page exists to price.

My read: **A or B, and B if the scope line is meant to hold.** I did not pick
— the phrasing is the page's authors' and the scope line is a deliberate
fence I would rather not widen on a tick's judgment.

## Also observed, not part of the fork

`EntryRefusalContext.declaredAs` (`src/Phase.ts:134`) now has no reader inside
this repo's package. It stays engine surface a consumer's own `refusesEntry`
reads (`docs/CHAIN-AUTHORING.md`, §12 shows exactly that), so it earns its
place as declared API rather than as a caller — flagged only in case a later
widening of the export pin reaches interface fields and reads it as residue.
