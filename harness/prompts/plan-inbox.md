# INBOX

<records>
{{RECORDS}}
</records>

<build-records>
{{BUILD_RECORDS}}
</build-records>

<ci-lanes>
{{CI_LANES}}
</ci-lanes>

<queue-parse-failure>
{{QUEUE_PARSE_FAILURE}}
</queue-parse-failure>

<pending-now>
!`d="{{PENDING_DIR}}"; test -d "$d" || { echo "queue directory absent: $d" >&2; exit 1; }; c=" {{CLAIMED_TAGS}} "; n=0; for f in "$d"/*.json; do test -e "$f" || break; n=$((n+1)); b="${f##*/}"; t="${b%.json}"; m=""; case "$c" in *" $t "*) m=" [in flight]" ;; esac; printf '=== %s%s\n' "$b" "$m"; cat "$f"; done; test "$n" -gt 0 || echo "(queue empty)"`
</pending-now>

{{CLAIMED_ENTRIES}}

<open-questions-index>
{{QUESTIONS_INDEX}}
</open-questions-index>

<plan-state>
!`p="{{PLAN_STATE_PATH}}"; test -e "$p" || { echo "(no plan state yet)"; exit 0; }; cat "$p"`
</plan-state>

<plan-state-shape>
Your plan state file takes one of these JSON shapes; each `<...>` is a value you fill, and a field not shown is refused:
{{PLAN_STATE_SHAPE}}
</plan-state-shape>

<artifacts>
queue (one `<tag>.json` per entry): {{PENDING_DIR}}
your plan state (this slice's own file): {{PLAN_STATE_PATH}}
open questions: {{QUESTIONS_DIR}}
record queues: {{RECORD_DIRS}}
discipline: {{DISCIPLINE}}
</artifacts>

{{DOMAIN}}

# TASK

**A queue that did not parse is this tick's whole job, ahead of everything below.** `<queue-parse-failure>` says the queue resolved, or names every error the parse reported and, on each, the entry file it was read out of. When it names errors, the queue you were handed is empty *because nothing resolved* — never because it drained — and `<pending-now>` carries each file's bytes under its own name. Repair exactly the files the errors name: fix only what those errors say, leave every other entry file byte-identical, and route nothing else this tick beyond what the repair needs. Never delete an entry file you merely could not parse — reconstruct it from the bytes, or leave it and say in the body that it is unreadable. Name the failure and what you recovered in the commit body. Your rewrite is the only repair there is: no other slice runs until the queue reads.

Drain the records. Each file in `<records>` is one record: a finding someone left in the inbox queue, a note a build tick left under the notes queue, or a note the loop left in the declared friction channel. **A record's directory is its kind** — one under `notes/parked/` is a park (the entry could not ship as written and stayed in the queue; widen its `files`, split it, or answer what it parked), one beside that directory is an observation from a tick that shipped, and one under the friction channel is what the loop had to say to its owner. Read the path, never the prose, for which it is. Route every record, then remove its file — `git rm` for a record the tree tracks, plain `rm` for a friction note, which is gitignored by machinery and in no commit to remove it from. The record queues are queues, not logs; never create a record yourself — the records gate refuses a plan commit that does.

Each record routes to exactly one of:

- a **pending entry**, with a `per` cite inside the spec locus ({{SPEC_LOCUS}}). Read `<pending-now>` first, as you read the question index: a standing entry that already covers this finding takes an amendment to that entry — a widened `files`, a sharpened `acceptance`, one more `tests[]` line — not a sibling filed beside it. Two producers filing one finding is a shape every honest decomposition reaches, so nothing refuses it for you; folding it is this route's job. A duplicate left standing is picked as a second entry over work its sibling already shipped, and comes back a `clean-exit` record a later drain spends a tick dropping;
- an **open question**, when human input is needed before code can land or no clean cite exists. Read the index above first: it names one file per question already open, and one that covers this finding takes an amendment to that file, not a sibling beside it;
- **accepted debt**: one line in the commit body with the reason, naming the shape family so a later drain counting it reads one name.

**An observation clears a bar before it is an entry.** A record the paths above make an observation — a note from a tick that shipped, a finding someone left in the inbox — becomes a pending entry only when the defect it names can **change behavior, hide a failure, or leave a vacuous verdict over load-bearing machinery**. Under that bar it is an accepted-debt line, however sharply the note put it, and the body's line is the whole of its route. A park, a blocker it names, and a red lane's failing title are not observations and route exactly as they route above — the bar decides between an entry and a debt line, and nothing else. Without it every shipped entry spawns the next through its own note, and the queue fills with work nothing asked for.

**A family noted three times files once.** A shape accepted as debt in three `plan:` commit bodies has cost more in re-noting than filing it would. The count runs over every plan commit body, whichever slice wrote it, and reaches back with no window on it at all: it ends itself, because a filed family stops being re-noted, and a window is how a family re-noted twice inside each one never files. File it then: one entry that claims no property — no `tests[]`, no `pins[]` — names the target shape, names every site in `files`, and ships on its own. Read the count off `git log` over those bodies, never estimated; under three, shape stays out of the queue.

**Research-leaning by default.** A note that claims a gap is re-verified against the current tree before it scopes an entry — search for the claimed-missing surface; a note stamped `observed at <sha>` narrows the check to `git log <sha>..HEAD`. Scope to the verified gap, never the reported one. A finding a chain could have decided routes to the consumer's declaration or to a boundary question, not to a package entry.

A record's byte cap is yours to report, never the gate's to revert: a record over it ships with the commit that wrote it, and `<records>` marks that file with what it measured. Name every marked record and its byte count in the commit body — that is the whole enforcement, so a tick that routes the record silently leaves the channel unbounded.

Route what routes cleanly. Leave the rest on disk rather than guess; the next inbox tick sees it again.

**Build's refusals are notes to plan too.** `<build-records>` carries every standing prior-attempt record and the last build wave's outcomes. A standing record is tagged with exactly one of the engine's no-commit modes — {{NO_COMMIT_MODES}} — or with one of the two facts that sit beside them rather than among them: `tip-moved`, the agent's span discarded because its base was rewritten underneath it, and `not-shipped`, a commit that landed and passed every gate which the `shipped` predicate declined. A `clean-exit` means a build agent looked and refused — "the work is already shipped" is the field-traced case; a `not-shipped` is a park, and its note under the parked directory says why. Each is yours to resolve now: drop the entry, re-scope it, or answer what it parked. A `gate-revert` record whose judge verdict says a named behavior *already passes on the base* is a line you mis-declared: move it from `tests[]` to `pins[]` if the entry adds the check for a property that already held, or drop it — never leave the entry unchanged, since build cannot move a line. A `tip-moved` is nobody's defect and needs no routing beyond a re-pick. A record whose tag is no longer in the queue is stale; say so in the commit body. An unreconciled record re-picks the same entry into the same wall.

**A red CI lane is a findings source too.** `<ci-lanes>` carries each declared lane's latest completed run of its workflow job, for the branch the repository's tip sits on. A `FAILING` lane's log is material, not a verdict: take the failing test titles out of it yourself and route each one exactly as you route a record — a pending entry, an open question, or an accepted-debt line. A finding is keyed by **lane name and title**, so a title already heading a queue entry or an open question is amended, never re-filed as a sibling. Then stamp the run you drained under that lane's name in `drainedRuns` (the plan state artifact — see the discipline file), exactly as you stamp a cursor: the block names the whole value to write, run and failing titles together, and a failing lane holds this slice live until its latest run is the one stamped there reporting the titles stamped with it — so a tick that drains without stamping wakes into the same run and re-files it. Write the value the block names rather than titles you lifted yourself: the titles in it are the lane's declared reader's answer, and the wake compares against that reader. `<plan-state>` is that file as this tick found it, and what you write replaces it whole: a lane you are not stamping this tick is copied forward verbatim from there, which the slice-state gate holds you to. A `FAILING` lane that did not wake you says so and still names its stamp — a red that persists unchanged advances on the tick that ran anyway, with nothing to drain out of it. A `GREEN` lane needs no drain, and a title it no longer reports closes in the commit body. An `UNREAD` lane is not a green one: file nothing and close nothing against it, and say in the body that it was unread. Every block says whether that lane is what woke this slice; a lane whose run failed and whose log the forge then refused says so **and** names the run it woke you over, so name that lane and that run in the body — and stamp that run under the lane's name exactly as you stamp a drained one, which the block names for you. There is nothing to drain out of an unread run, but leaving it unstamped wakes this slice into the same run every tick for as long as the forge withholds the log; its findings arrive from the next run that fails.

**You do not touch the derive cursor.** A record you route may well *be* a spec commit's derivation — the finding was about what that commit changed, and the queue now carries it — and even so `derivedThrough` is the derive slice's alone: your state file is your own, and the fence reverts a commit that writes a sibling's. Say in the body which spec commit a record you routed covers; the derive tick that wakes on it judges those sections done and moves its own cursor. One cheap tick, paid so that no cursor has two hands on it.

Entry and artifact discipline: `{{DISCIPLINE}}` — read it before writing the queue or a question.

{{PUT_DOWN}}

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names each drained record and where it went. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
