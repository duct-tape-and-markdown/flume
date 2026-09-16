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

<derive-cursor>
{{DERIVE_CURSOR}}
</derive-cursor>

<queue-parse-failure>
{{QUEUE_PARSE_FAILURE}}
</queue-parse-failure>

<pending-now>
!`cat "{{PENDING_PATH}}"`
</pending-now>

<open-questions-index>
{{QUESTIONS_INDEX}}
</open-questions-index>

<artifacts>
queue: {{PENDING_PATH}}
plan state: {{PLAN_STATE_PATH}}
open questions: {{QUESTIONS_DIR}}
record queues: {{RECORD_DIRS}}
discipline: {{DISCIPLINE}}
</artifacts>

{{DOMAIN}}

# TASK

**A queue that did not parse is this tick's whole job, ahead of everything below.** `<queue-parse-failure>` says the queue resolved, or names the file and every error the parse reported. When it names errors, the queue you were handed is empty *because nothing resolved* — never because it drained — and `<pending-now>` carries the bytes that failed. Repair them: rewrite the queue from those bytes, keeping every entry that survives the read intact and fixing only what the errors name, and route nothing else this tick beyond what the repair needs. Never write `[]`, and never drop an entry you merely could not parse — reconstruct it from the bytes, or leave it and say in the body that it is unreadable. Name the failure and what you recovered in the commit body. Your rewrite is the only repair there is: no other slice runs until the queue reads.

Drain the records. Each file in `<records>` is one record: a finding someone left in the inbox queue, or a note a build tick left under the notes queue — an observation for you, or a park (the entry could not ship inside its fence; widen its `files`, split it, or answer what it parked). Route every record, then `git rm` its file. The record queues are queues, not logs; never create a record yourself — the records gate refuses a plan commit that does.

Each record routes to exactly one of:

- a **pending entry**, with a `per` cite inside the spec locus ({{SPEC_LOCUS}});
- an **open question**, when human input is needed before code can land or no clean cite exists. Read the index above first: it names one file per question already open, and one that covers this finding takes an amendment to that file, not a sibling beside it;
- **accepted debt**: one line in the commit body with the reason.

**Research-leaning by default.** A note that claims a gap is re-verified against the current tree before it scopes an entry — search for the claimed-missing surface; a note stamped `observed at <sha>` narrows the check to `git log <sha>..HEAD`. Scope to the verified gap, never the reported one. A finding a chain could have decided routes to the consumer's declaration or to a boundary question, not to a package entry.

A record's byte cap is yours to report, never the gate's to revert: a record over it ships with the commit that wrote it, and `<records>` marks that file with what it measured. Name every marked record and its byte count in the commit body — that is the whole enforcement, so a tick that routes the record silently leaves the channel unbounded.

Route what routes cleanly. Leave the rest on disk rather than guess; the next inbox tick sees it again.

**Build's refusals are notes to plan too.** `<build-records>` carries every standing prior-attempt record and the last build wave's outcomes. A standing record is tagged with exactly one of the engine's no-commit modes — {{NO_COMMIT_MODES}} — or with one of the two facts that sit beside them rather than among them: `tip-moved`, the agent's span discarded because its base was rewritten underneath it, and `not-shipped`, a commit that landed and passed every gate which the `shipped` predicate declined. A `clean-exit` means a build agent looked and refused — "the work is already shipped" is the field-traced case; a `not-shipped` is a park, and its note in the notes queue says why. Each is yours to resolve now: drop the entry, re-scope it, or answer what it parked. A `gate-revert` record whose judge verdict says a named behavior *already passes on the base* is a line you mis-declared: move it from `tests[]` to `pins[]` if the entry adds the check for a property that already held, or drop it — never leave the entry unchanged, since build cannot move a line. A `tip-moved` is nobody's defect and needs no routing beyond a re-pick. A record whose tag is no longer in the queue is stale; say so in the commit body. An unreconciled record re-picks the same entry into the same wall.

**A red CI lane is a findings source too.** `<ci-lanes>` carries each declared lane's latest completed run of its workflow job, for the branch the repository's tip sits on. A `FAILING` lane's log is material, not a verdict: take the failing test titles out of it yourself and route each one exactly as you route a record — a pending entry, an open question, or an accepted-debt line. A finding is keyed by **lane name and title**, so a title already heading a queue entry or an open question is amended, never re-filed as a sibling. Then stamp the run you drained under that lane's name in `drainedRuns` (the plan state artifact — see the discipline file), exactly as you stamp a cursor: the block names the whole value to write, run and failing titles together, and a failing lane holds this slice live until its latest run is the one stamped there reporting the titles stamped with it — so a tick that drains without stamping wakes into the same run and re-files it. Write the value the block names rather than titles you lifted yourself: the titles in it are the lane's declared reader's answer, and the wake compares against that reader. A `FAILING` lane that did not wake you says so and still names its stamp — a red that persists unchanged advances on the tick that ran anyway, with nothing to drain out of it. A `GREEN` lane needs no drain, and a title it no longer reports closes in the commit body. An `UNREAD` lane is not a green one: file nothing and close nothing against it, and say in the body that it was unread. Every block says whether that lane is what woke this slice; a lane whose run failed and whose log the forge then refused says so **and** names the run it woke you over, so name that lane and that run in the body — and stamp that run under the lane's name exactly as you stamp a drained one, which the block names for you. There is nothing to drain out of an unread run, but leaving it unstamped wakes this slice into the same run every tick for as long as the forge withholds the log; its findings arrive from the next run that fails.

**What you routed, you derived — advance the derive cursor through it.** `<derive-cursor>` names `derivedThrough` and every spec-locus commit standing past it, oldest first. A record you route into an entry or an open question often *is* one of those commits' derivation: the finding was about what that commit changed, and the queue now carries it. When the records you drained leave nothing in a listed commit's spec change unqueued, set `derivedThrough` to that commit's sha in the plan state artifact — otherwise the derive slice wakes on it, finds every section already queued, and spends a whole tick moving the cursor alone.

Two bounds, and neither is negotiable. **Advance only through a leading run**: the oldest listed commit whose derivation no record here claimed stops the advance, and no commit behind it is ever stepped over — a cursor past an underived commit is that commit derived by nobody. And **advance only to a sha the block above names**: never one you resolved yourself, never HEAD, never a commit you found by reading git. The block is a closed list of candidates; a block that names none, or that refuses, is a tick that advances nothing. Say in the commit body which commit you advanced through and which record claimed it — or that you carried `derivedThrough` forward untouched.

Entry and artifact discipline: `{{DISCIPLINE}}` — read it before writing the queue or a question.

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names each drained record and where it went. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
