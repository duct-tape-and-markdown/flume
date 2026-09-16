# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Does the harness declaration mirror `Chain.capabilities`?

**NEEDS AMENDMENT.** A pilot's per-job `declaration.json` carries the
capabilities its entries may require; the harness declaration cannot. The
record asked plan to verify which side the gap is on. Verified on this tree:
the engine side is complete — `Chain.capabilities` is read at
`src/Dispatcher.ts:1385` and `:1603`, decides a `requiresCapability` entry's
pickability (`src/Dispatcher.ts:3996`, `src/PendingSchema.ts:648`), and
`flume status` already prints one line per entry blocked on an unasserted one
(`src/cli.ts:514`). The harness side has no field: no row in
`spec/harness.md`'s declaration table, nothing in `harness/declaration.ts`.
So under the package, a `requiresCapability` entry is unpickable forever and
no declaration can change that.

- **(a)** One row in the table, one schema field, one line of pass-through in
  the factory. The engine already consumes the value; nothing in `src/`
  moves.
- **(b)** Capabilities vary per unit of work, not per repository, so the
  field belongs beside a job — `jobs[name].capabilities` alongside
  `specLocus` and `fence` — with the repo-level value as the one-job case.
- **(c)** Leave it: a consumer needing capability gating writes its own
  chain.

Recommended (a), shaped so (b) is a later widening rather than a rewrite:
`jobs` already overrides shared values per job (*What a consumer declares*),
so the field is the same object either way. (c) is the verbatim-copying
detector in `engine-boundary.md`, *Surface, not prescription* — every
consumer with a capability-gated entry writes the same pass-through.

## What does `flume help <subcommand>` answer?

**PARKED.** `flume help` shipped as an arm on `--help`'s branch
(`src/cli.ts`), so `flume help status` prints the top-level help and ignores
the trailing positional — `flume --help status` has always done that, and
`spec/cli.md`'s trailing-positional refusal class is written over
subcommands, which `help` is not (`isSubcommand("help")` is false). The build
tick called it and said so rather than deciding silently; the surface is
spec-silent either way.

- **(a)** Keep it: `help` is `--help` spelled as a verb, and a trailing
  positional is ignored wherever `--help` appears.
- **(b)** Refuse exit 2, the usage class, as an unrecognized trailing
  positional does on every other verb.
- **(c)** Route `help <cmd>` to that subcommand's page, and an unknown name
  to (b).

Recommended (c). It is what `git help`, `npm help` and `cargo help` all do,
so it is the reading an operator arrives with; it costs a lookup rather than
a new surface, because `HELP_SUB` (`src/cliHelp.ts:83`) already holds one
page per subcommand and `isSubcommand` already decides the name. (a) is
defensible but makes `help` the one verb whose argument is silently
discarded, which is the shape *Loud or nothing* exists to refuse.

## Is a `docs/` page's claim about a live interface pinnable, and does any lens read `docs/`?

**PARKED.** Two copies noted by the build tick that wrote them, flagged
rather than decided. The runner pricing is stated in
`docs/MIGRATING-0.16.md` § 6 *Pricing the runner row* and in
`docs/CHAIN-AUTHORING.md` *What adoption costs*; the two go stale
independently if `Runner`/`RunResult` changes shape. Separately, § 0's
node-version table restates measurements from
`.claude/rules/platform-facts.md`. `docs/` is outside the sweep domain
(`.flume/declaration.ts`, `slices.sweep.domain`), so nothing re-reads either.

The precedent cuts both ways. `tests/cliHelp.test.ts` already pins
`docs/CLI.md` sections against derived exit-code ranges — prose read against
the program, which `engineering.md`'s *Narration is the ladder's bottom rung*
sanctions. But that section names only two carve-outs, neither of which is a
`docs/` page, and rules that prose read against prose stays with its authors.

- **(a)** Pin only what reads against the program: the operations both runner
  passages name resolve against `Runner`'s declared members, and every member
  is named. The node table stays prose — it restates a rule page, which is
  prose against prose.
- **(b)** Widen `slices.sweep.domain` to `docs/` so the expired-narration and
  consumer-restatement lenses reach it. Touches `.flume/declaration.ts`,
  outside build's fence, and costs a frontier entry per `docs/` commit.
- **(c)** Neither: a dated migration note is allowed to go stale by
  construction, and `docs/CHAIN-AUTHORING.md` is the standing home.

Recommended (a). It is the arm the existing precedent already licenses, and
it is not exclusive of (b) or (c). If (a) is taken, *Narration is the
ladder's bottom rung* wants the third carve-out spelled, since `docs/` is not
shipped in the package's `files` allowlist and so is not the `.d.ts` hover
text the first carve-out names.

**A falsified claim, found by hand rather than by a lens.**
`docs/surveys/consumer-chains/consumer-a.md` § 3 #6 asserts `AgentUsage`
"**has no cost field**" and `INDEX.md` § 3 calls `total_cost_usd` "the
clearest single missing field in the survey". Both were true when written and
are false now: `AgentUsage.costUsd` (`src/Agent.ts:118`) landed at `64c781f1`,
lifted at the same decode as the token fields. So the survey currently tells a
consumer to hand-scan raw stdout for a field the engine reports — (c)'s cost,
stated concretely, and the first instance of this question's subject observed
rather than hypothesised. Whether a survey is dated-by-construction like a
migration note is the same fork; a survey's *coverage* column is a claim about
live surface in a way its *observation* column is not.

Correction to the recommendation above: `docs/` **is** in the package's `files`
allowlist (`package.json`, only `docs/PRD-*.md` excluded), so these pages ship
to every consumer. The first carve-out still does not reach them — a markdown
page is not `.d.ts` hover text — but "not shipped" is not the reason, and the
blast radius is larger than the parenthetical implied.

**A third instance, and a lens that does read `docs/` on disk.** The
migration notes are a linked list — each opens by naming the previous note in
the series and closes by linking it — and nothing resolves that link, so a
wrong or missing neighbour ships green. Unlike the two copies above, the claim
reads against **disk** rather than against the program or against prose: the
series order is decidable from the `MIGRATING-<minor>.md` names, which is the
reading *Narration is the ladder's bottom rung* already licenses for a page
name. Filed as a `pins[]` line on
`EACH-MIGRATION-NOTE-RESOLVES-THE-NOTE-BEFORE-IT`, which joins the
`CHANGELOG.md`-against-`docs/` coverage arm that shipped in
`tests/harnessPackaging.test.ts` — so the suite already reads `docs/` on disk
whichever way this question is ruled, and (a) would want a fourth arm naming
it: a page **name** read against the tree, never a page's sentence.

**The pin shipped, and its coverage is 4 of 7 — plus one dangling name it
cannot see.** `tests/harnessPackaging.test.ts` now resolves each note's
"previous note in this series" name against the notes on disk. Only
`MIGRATING-0.13/0.14/0.15/0.16` carry that sentence; `0.10`, `0.11` (which
routes to `0.10` in its own words) and `0.12` (which names no earlier page)
are skipped, not failed — the arm judges the notes that make the claim. And
`docs/MIGRATING-0.10.md:10` names `MIGRATING-0.8.md`, a page that does not
exist: the citation pin's page-name arm reads `src/`, `harness/`, `tests/`
and the sweep domain, so a dangling page name in `docs/` resolves against
nothing. Whether the 0.8 cite is deliberate history — the note says that page
is one it *replaces* — is this question's fork again, and (a)'s fourth arm
would red it either way, so the ruling wants to say which.

**A fourth instance, this one already false.** `docs/CHAIN-AUTHORING.md`
*Writing a custom Gate* tells chain authors "Singleton phases never run
`afterMerge` (they commit straight to the trunk)" — untrue since
`spec/worktrees.md` *Singleton runs in a worktree*, and verified false on disk
this tick (`runSingleton` filters `phase.gates` for `when === "afterMerge"`
and runs them on trunk). Filed as
`CHAIN-AUTHORING-STOPS-DENYING-A-SINGLETON-AFTERMERGE`; the fix needs no
ruling, the *pin* does. The same page never enumerates `GateContext`'s fields
at all (`CHAIN-AUTHORING-ENUMERATES-WHAT-A-GATE-RECEIVES`), which is exactly
the field-name-against-declaration reading (a) describes for `Runner`.

## What row does a declared findings script take, and what shape is its stdout?

**PARKED.** `spec/harness.md` *Declared findings sources* ratifies a fourth
source: "a command the inbox slice runs at the tip before it renders, whose
stdout is records — one per finding, in the record shape — drained like the
rest." Verified on this tree: no field exists (`harness/declaration.ts`), and
*What a consumer declares*'s table carries no row for it — the table has `ci`
for the lane source and nothing for this one. The friction channel is in the
same position and is derived anyway
(`THE-INBOX-SLICE-READS-A-DECLARED-FRICTION-DIRECTORY`): its field mirrors the
engine's `Chain.friction` with nothing to invent. This one has no such anchor,
and the real fork is not the field name.

**The fork is the record shape on stdout.** A record on disk is a file — a
name and bytes (*Records as one file each*). One record per line cannot carry
the bytes; a concatenation needs a frame, and a frame is a vocabulary two
sides must agree on, which is the seam `engineering.md`, *A seam gate reads
what the real writer wrote*, governs. Nothing in the section says which.

- **(a)** NDJSON, one `{ name, body }` object per line; the package
  materializes each as a record file so the drain is literally the drain it
  already runs. The record's name and bytes are stated, never parsed out of
  prose, and the agreement pin has a real writer to drive.
- **(b)** Stdout is a directory path the script wrote records into — the
  script does the file writing, the package only drains. Cheapest to state,
  but the script then owns a naming and collision policy the package owns
  everywhere else, which is the verbatim-copying detector in
  `engine-boundary.md`, *Surface, not prescription*.
- **(c)** A framed text stream (`--- name ---` blocks), matching the render
  `inboxWindow` already produces. Reuses a render format as a wire format,
  and the render is the package's to change under a consumer.

Recommended (a). Whichever is ruled, the declaration table wants the row
spelled with it — and the friction row alongside, which the derived entry
above ships against a table that does not yet name it.

## Three `spec/` sentences name a helper the extraction moved

**NEEDS AMENDMENT.** A build note reported one stale cite; three are stale on
this tree, and the rule that governs them already forbids the shape:
`.claude/rules/spec-writing.md`, *A claim names behavior, never location*,
says a sentence may not name "an internal helper, or the call order between
internal functions."

- `spec/loop.md:476` — "`Dispatcher.AgentTermination` declares this
  deliberate". Not a member of `Dispatcher` at all now: a module-private
  `type` in `src/tickAttempt.ts`.
- `spec/loop.md:480` — "`Dispatcher.invokeAgent` forwards it only when set".
  A module-private function in `src/tickAttempt.ts`.
- `spec/pending.md:49` — "`Dispatcher.writeRevertNote`". Same file, same
  status.

`Dispatcher.tick` (six sites) and `Dispatcher.readPending` still resolve, and
`DispatcherOptions.tickTimeoutMs` is declared public surface — none of those
is in scope here. No autonomous phase can fix these: `spec/` is the human's
maintenance surface (`spec-plan-build.md`), so this cannot be an entry.

- **(a)** Restate each sentence as the behavior it was describing, dropping
  the helper name — what the rule's own test asks for. The termination
  sentence becomes "with a commit in hand, how the process ended is
  irrelevant"; the timeout sentence keeps `DispatcherOptions.tickTimeoutMs`
  and drops the forwarder; the revert-note sentence names the artifact, not
  its writer.
- **(b)** Re-point the three at `src/tickAttempt.ts`. Cheapest, and
  re-commits the shape the rule refuses — the next extraction falsifies them
  again.
- **(c)** Leave them and widen the citation pin's carve-out
  (`engineering.md`, *Narration is the ladder's bottom rung*) to resolve a
  backticked identifier in `spec/` against the trees. Makes the staleness
  red, but the section rules that prose about the harness stays with its
  authors, and the carve-out it grants names `src/`, `harness/`, `tests/`
  comments only — so this is a ratified widening, not a reading.

Recommended (a). It is what the rule already says, and it is the only arm
that survives the next split. (c) is separable and worth its own ruling —
(a) leaves nothing mechanical reading `spec/`'s identifiers, so the fourth
instance of this arrives the same way the first three did, from a build note
after the fact.

## Does 0.15.0's shipped `### Breaking` list get amended?

**PARKED.** `TickResult.quarantinedTags` went `readonly string[]` ->
`readonly QuarantinedTag[]` at 0.15 (`src/Phase.ts:198` at `v0.14.0`,
`:288` at `v0.15.0`) — a public-API break on the type a `handoff` reads.
0.15.0's changelog section carries a `### Breaking` heading and files this
one under `### Added` (`CHANGELOG.md:231`). `spec/cli.md` *Versioning
policy* says each public-API breaking change lands under `### Breaking`; the
same section says changelog curation is human-performed at cut time, which is
why this is a question and not an entry. `docs/MIGRATING-0.15.md` § 5.6 walks
the break and says out loud that the release did not list it.

- **(a)** Move the bullet under 0.15.0's `### Breaking`. One line; the note's
  § 5.6 sentence then reads false and shrinks in the same commit. The tag and
  the published tarball are untouched.
- **(b)** Leave it. A shipped section is a record of what the cut said, the
  migration note is the consumer's actual path, and it already covers this.
- **(c)** Amend, and promote a rung: an API-surface diff between two tags read
  against the later one's `### Breaking` list. The real check — nothing today
  reads a break against the section that should name it — but it needs this
  ruling first and a tag-to-tag `.d.ts` comparison the repo has no machine
  for.

Recommended (a). The changelog documents the API, not the curation, and a
consumer reading 0.15.0's Breaking list to size an upgrade currently misses a
type change that reds their build. (c) is separable and worth its own ruling.

## What does the git floor say about a version it could not read?

**NEEDS AMENDMENT.** `spec/chain.md`, *The package a chain loads through*,
states two arms: below the floor warn once, at or above say nothing. A `git
--version` that cannot be read — no git on PATH, a wrapper answering in its
own words — is neither, and the shipped code takes a third arm:
`gitFloorWarning` (`src/cli.ts:168`) warns there too, calling the floor
*unconfirmed* rather than met, declared and cited at the site. Held by "a git
whose version cannot be read warns that the floor is unconfirmed". No
autonomous phase can close this: the missing sentence is in `spec/`
(`spec-plan-build.md`).

- **(a)** Name the third arm as shipped: an unread version warns, the floor
  unconfirmed rather than met.
- **(b)** Rule the arm quiet — an unread version starts silently. Cheaper
  output, and it is precisely the silent degrade `engineering.md` *Loud or
  nothing* refuses: reading silence as "at or above" turns a missing
  instrument into a met floor.
- **(c)** Refuse the run on an unread version. Overshoots — the degrade the
  floor bounds is worktree reclamation alone, and the spec already rules the
  below-floor case a warning rather than a refusal.

Recommended (a). It is what shipped and what the posture already requires;
the sentence is the only thing missing.

## Does the teardown harvest take the dot-name skip?

**NEEDS AMENDMENT.** `spec/chain.md` *`Chain.friction` — the declared friction
channel* rules **a dotfile is not a note** and names three surfaces: the
count, the listing, the read verb. All three now skip by name alone
(`isDotName`, `src/paths.ts`). The harvest is not among them, and on this tree
`harvestFriction` (`src/friction.ts`) filters `e.isFile()` only, then stamps
every moved file `<tag>--<stamp>--<name>`. So a harvested dot-prefixed file
lands in the primary dir under a name that is **no longer dot-prefixed**: the
skip cannot see it afterwards, and the channel reports a placeholder as a note
awaiting routing, permanently.

The harvest's tracked-at-HEAD bound covers the usual case — a placeholder
exists because git forced it, so it is committed, so it is not harvested. It
does not cover an untracked one: macOS writes `.DS_Store` into any directory
Finder touches, and a `setupWorktree` hook that materializes the mirror dir
can seed its own.

- **(a)** The harvest takes the same `isDotName` filter, one more surface on
  the section's list. The placeholder dies with the worktree, which is what a
  placeholder is for.
- **(b)** The harvest stays content-blind and keeps moving them — the section
  names three surfaces deliberately, and delivery is not interpretation. Costs
  the property: a dotfile becomes a note by being relayed.
- **(c)** Preserve dot-ness in the stamped name (`.<tag>--<stamp>--gitkeep`) so
  the downstream skip still bites. Keeps both properties and invents a naming
  rule no other surface reads.

Recommended (a). "The skip is by name alone, never by content" is the stated
property, and a surface that renames a skipped name into an unskippable one
falsifies it downstream of itself — which is the shape *Loud or nothing*
refuses. The amendment is one clause on the existing bullet; until it lands
this cannot be an entry, because the section's enumeration is what an entry
would have to read as illustrative.

## What spelling does the completion summary's spend line take?

**PARKED.** `spec/loop.md` *Exit codes — the run never lies to CI* ratifies
that the summary "totals the run's agent usage by phase" and stops there, so
the shape was the build tick's to pick and it said so rather than deciding
silently. Shipped: one segment per phase in first-invocation order, every
total the supervisor holds named, raw counts rather than abbreviated,
appended last so an error or abort still reads first — `build x3 (7 turns,
4.5s, 900 in / 50 out tokens, 13 cache-write / 130 cache-read, $2.2500)`. A
phase with no row is absent, never present at zero. All of it is one function
(`phaseUsageSegment`, `src/cliVerdict.ts`).

The operator is the audience, so the pressure-test is human:

- **(a)** Keep it. Every total is named, nothing is rounded away, and an
  operator sizing a run's cost reads it without a second command.
- **(b)** Cost and turns only, tokens dropped. The line an operator actually
  scans is money; token counts belong to `tick-verdicts.jsonl`, which holds
  them already.
- **(c)** Cost only, with the full breakdown behind a flag.

No answer blocks anything — it shipped, and a re-spelling is one function.

## Is prettier the tree's formatter, or a tool to keep out of it?

**NEEDS AMENDMENT.** The repo declares no prettier config and no prettier
dependency, and the tree is hand-formatted at width 100. `npx prettier --write`
therefore reflows a whole file at prettier's default 80 — a build tick paid
this and reformatted by hand. Nothing on disk warns the next one.

- **(a)** One line in `.claude/rules/platform-facts.md`: the repo has no
  prettier config, so the tool reflows at 80 against a tree written at 100 —
  format by hand. That page is the declared home for a measured toolchain
  fact, and it is the only surface a fresh tick re-reads.
- **(b)** Declare `.prettierrc` at `printWidth: 100` and let the tool be
  right. Risk: a config invites a tree-wide reflow, and prettier's other
  defaults do not match what is on disk either, so the first `--write` is a
  large unrelated diff.
- **(c)** Nothing; the next tick pays it again.

Recommended (a). (b) adopts a formatter as a side effect of fixing a footgun,
which is a posture decision on its own terms and wants its own ask.
