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
