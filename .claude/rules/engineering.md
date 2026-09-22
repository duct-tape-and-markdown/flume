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
- **A shrink is not complete until the facts the removed prose was covering
  for are re-homed.** A doc comment shrunk to a pointer may have been the only
  citation a sibling site in the same file was leaning on; the promoting
  commit moves that cite to the site that decides on the fact, or the shrink
  has orphaned a claim while looking like tidying.
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
- **The ladder governs the engine's behavior, and stops there.** Prose about
  the harness itself — a rule page, PROTOCOL, a prompt, `spec/` — is held by
  its authors and is never promoted into the suite. A check on how the
  harness's own prose is written is harness governance, which this page does
  not administer; a suite that reads prose against prose is that governance
  wearing engine discipline, and every section here becomes a generator
  against it. Three carve-outs, each reading prose against the program rather
  than against prose. A doc comment reachable from the `exports` map's
  `.d.ts` is the hover text a chain author reads, so it is engine surface and
  may be pinned for what it says. A page under `docs/` or the README that
  states what a shipped interface does — a verb's exit codes, a runner's
  operations, the files a verb writes — is the surface a consumer reads
  before the hover text, so it may be pinned for what it says against the
  interface it describes, and never against another page: a passage that
  restates a rule page is prose against prose and stays with its authors. A
  page name such a passage cites resolves on disk, as a page name does
  anywhere, so a note that names its neighbour in a series names one that
  exists.
  And a reference in a comment is not prose when it is a token the working
  tree or the program can answer, read as the token and never its meaning —
  that predicate is the rule, and the classes the suite resolves today are
  its instances: a backticked identifier or a backticked repo-relative path
  in `src/`, `harness/`, or `tests/`, where the program reaches; a `*.md`
  page name, with or without backticks, in any tree the sweep domain names,
  since a filename resolves on disk and is never a sentence; the `#fragment`
  a markdown link carries into such a page, which resolves against that
  page's own headings the way a `per` cite already does; the italicized
  section half of a `` (`page.md`, *Section*) `` pair, resolved against that
  page's headings and bolded bullet leads, exact after backtick
  normalization — no prefix arm, so an abbreviation is a rewrite, not a
  match; and a `§ N` cross-reference on a `docs/` page, resolved against
  that page's own numbered headings where it has any and left as prose where
  it has none. A pin may resolve each against the declarations those trees
  hold and the working tree, so a deleted symbol, a renamed page, or a
  renumbered section cannot leave its citations standing. A class this
  predicate admits and the suite does not yet resolve is a plan entry, not a
  question.
  An identifier the citation pairs with a path, `` `name` (`src/file.ts`) ``,
  resolves in that file: where a declaration lives is the token's fact, not
  its meaning, and a split that moves the job moves the pair or is caught.
  A path named on its own is context, and no pair is read into it; nor is a
  pair whose path is a `*.md` page — no declaration lives in a page, so the
  identifier resolves repo-wide and the page against disk.
  A test's title carries the page-name arm alone: a title is a string
  literal, and a literal is itself a resolution arm, so an identifier in a
  title would resolve itself; only the `*.md` name, read against the working
  tree, can bite there. Prose the package never ships, read for what it says,
  stays with its authors.

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
  `pending.json`, a question listing beside `questions/`, a HEAD sha
  beside git — is the same defect wearing prose. The artifact that owns the
  fact is the only one that states it; everything else points.
- The test is ownership, not convenience: if regenerating the copy from its
  source would be mechanical, the copy should not exist.

**Why:** these files are re-injected verbatim into every tick, so a restated
fact is both a per-tick token tax and a second thing that can go stale
against the source it paraphrases.

## A fact the engine holds is reported, never rediscovered

The bar above does not stop at the package boundary. Any value the engine
computes or decodes that changes what it does next — a set that gates
selection, the tip it read, a usage line it already parsed, a path rule it
keys files by — is on a surface a chain reads: `TickResult` for the handoff,
the tick verdict for disk, the API for helpers. What the engine keeps only in
memory, a chain cannot read and will rebuild.

- Internal state that affects dispatch and appears on no reporting surface is
  residue fileable against this section — before a consumer hits it, not
  after.
- **A chain restating an engine fact is evidence against the engine, not the
  chain.** Re-parsing an agent stream the engine already decoded, copying a
  filename rule the engine owns, inferring whether a phase ran from the shape
  of its commit: each is a fact the engine failed to hand out. The finding is
  filed here, and the chain's copy is deleted in the adopting commit.
- Reported means a **fact, never a verdict**. The engine says what it skipped
  and why; what to do about it stays the chain's (`engine-boundary.md`).

**Why:** a rebuilt copy reads as mechanism, so nothing re-litigates it, and it
fails silently the moment the engine changes shape.

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
- **A test's title is a claim its body asserts, in the stated direction.** A
  title naming a subject the body never exercises as titled — "both throw"
  over a `not.toThrow` — is the same failure with `n > 0`: the pin fired and
  the subject was wrong. A `pins[]` line buys exactly a title, so a mislabelled
  test reads as covering a property it never touched. Fileable against this
  section wherever a build or sweep tick reads one.

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

## A module is one job

A module holds one job, named by its file and stated by its header. Cohesion
is not size — a long module holding one job is fine — but a module past
which a second job was appended rather than homed is the shape autonomous
ticks produce by default, and this section is how the sweep sees it.

- A module whose header disclaims what its body carries — "the assembly
  point, and nothing else" above ninety lines of gate logic — is residue
  fileable against this section, and the fix is the split the header
  already implies.
- A job the tree gives no file to — a type every sibling imports from the
  module that happens to hold it, an I/O family fronting an orchestrator —
  is a cycle waiting to be named. It moves to the file its name is.
- A helper spelled in three modules has one home; a request, site, or
  verdict shape spelled three ways by three siblings has one vocabulary.
- A second copy of a sequence — two legs that spell the same steps and
  differ only in how they return — is one function with two callers.
- **A split re-homes the citations it strands.** A comment naming the old
  file for a fact that moved with the job still resolves — the citation pin
  reads the token, never its meaning, and the old file still exists — so the
  pointer is the split's to move, in the same commit, or the split has left a
  green citation at the wrong door.

A finding under this section files as an **entry**, never a debt line: the
refactor is behavior-free, and the typecheck, the suite, and the export and
citation pins hold it. The entry names the target shape — which file takes
which job — so build moves code rather than judging it.

**Why:** seams stay sound while files accumulate, because nothing re-reads a
module for what it has become; a job appended today is the module someone
cannot find tomorrow.

## An export earns its consumer

Public surface with no consumer is residue: an export born as scaffolding
outlives its scaffold and becomes API someone must excavate later.

- An entry in `src/index.ts`, or any widened visibility, needs a caller
  outside its own module (a test counts) **or** its place in the package's
  public surface as declared API.
- Over the package's exports the verdict is mechanical: the suite resolves
  every `src/` and `harness/` export against the `exports` map and
  cross-module references through the TypeScript program, and an unearned
  export reds the default lane. Reachability reads type positions only — a
  helper a public method calls is not public surface for having been called.
- Beyond that pin, an absence verdict never rests on a bare text search.
  Confirm a dead-symbol finding with a search that resolves symbols — LSP
  references (`code-navigation.md`), a host prerequisite
  (`platform-facts.md`, *nvm scopes global packages to one node version*) —
  never a plain no-hits. A host without the instrument leaves the verdict
  unmade, never approximated by grep.
