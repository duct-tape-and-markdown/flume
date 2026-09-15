# INBOX

<records>
{{RECORDS}}
</records>

<build-records>
{{BUILD_RECORDS}}
</build-records>

<pending-now>
!`cat "{{PENDING_PATH}}"`
</pending-now>

<open-questions-index>
!`p="{{QUESTIONS_PATH}}"; test -e "$p" || { echo "(none open)"; exit 0; }; grep -n '^## ' "$p" || { s=$?; test "$s" -eq 1 || exit "$s"; echo "(none open)"; }`
</open-questions-index>

<artifacts>
queue: {{PENDING_PATH}}
plan state: {{PLAN_STATE_PATH}}
open questions: {{QUESTIONS_PATH}}
record queues: {{RECORD_DIRS}}
discipline: {{DISCIPLINE}}
</artifacts>

{{DOMAIN}}

# TASK

Drain the records. Each file in `<records>` is one record: a finding someone left in the inbox queue, or a note a build tick left under the notes queue — an observation for you, or a park (the entry could not ship inside its fence; widen its `files`, split it, or answer what it parked). Route every record, then `git rm` its file. The record queues are queues, not logs; never create a record yourself — the records gate refuses a plan commit that does.

Each record routes to exactly one of:

- a **pending entry**, with a `per` cite inside the spec locus ({{SPEC_LOCUS}});
- an **open question**, when human input is needed before code can land or no clean cite exists. Open the questions file first: the index above is headings only, and a question already open takes an amendment, not a sibling;
- **accepted debt**: one line in the commit body with the reason.

**Research-leaning by default.** A note that claims a gap is re-verified against the current tree before it scopes an entry — search for the claimed-missing surface; a note stamped `observed at <sha>` narrows the check to `git log <sha>..HEAD`. Scope to the verified gap, never the reported one. A finding a chain could have decided routes to the consumer's declaration or to a boundary question, not to a package entry.

Route what routes cleanly. Leave the rest on disk rather than guess; the next inbox tick sees it again.

**Build's refusals are notes to plan too.** `<build-records>` carries every standing prior-attempt record and the last build wave's outcomes. A standing record is tagged with exactly one of the engine's no-commit modes — {{NO_COMMIT_MODES}} — or with one of the two facts that sit beside them rather than among them: `tip-moved`, the agent's span discarded because its base was rewritten underneath it, and `not-shipped`, a commit that landed and passed every gate which the `shipped` predicate declined. A `clean-exit` means a build agent looked and refused — "the work is already shipped" is the field-traced case; a `not-shipped` is a park, and its note in the notes queue says why. Each is yours to resolve now: drop the entry, re-scope it, or answer what it parked. A `gate-revert` record whose judge verdict says a named behavior *already passes on the base* is a line you mis-declared: move it from `tests[]` to `pins[]` if the entry adds the check for a property that already held, or drop it — never leave the entry unchanged, since build cannot move a line. A `tip-moved` is nobody's defect and needs no routing beyond a re-pick. A record whose tag is no longer in the queue is stale; say so in the commit body. An unreconciled record re-picks the same entry into the same wall.

Entry and artifact discipline: `{{DISCIPLINE}}` — read it before writing the queue or the questions file.

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names each drained record and where it went. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
