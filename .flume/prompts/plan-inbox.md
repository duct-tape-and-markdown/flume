# INBOX

<records>
!`node .flume/delta-window.mjs records`
</records>

<build-records>
!`node .flume/delta-window.mjs build-records`
</build-records>

<pending-now>
!`cat .flume/plan/pending.json`
</pending-now>

<open-questions-index>
!`grep -n '^## ' .flume/plan/open-questions.md || echo "(none open)"`
</open-questions-index>

# TASK

Drain the records. Each file above is one record: a finding under `.flume/inbox/`, or a note a build tick left under `.flume/plan/notes/` — an observation for you, or a park (the entry could not ship inside its fence; widen its `files`, split it, or answer what it parked). Route every record, then `git rm` its file. The directories are queues, not logs; never create a record yourself (`.flume/PROTOCOL.md`, *Records: one file each* — the `records` gate refuses it).

Each record routes to exactly one of:

- a **pending entry**, with a `per` cite into `spec/*.md` or `.claude/rules/*.md`;
- an **open question** in `.flume/plan/open-questions.md`, when human input is needed before code can land or no clean cite exists. Open the file first: the index above is headings only, and a question already open takes an amendment, not a sibling;
- **accepted debt**: one line in the commit body with the reason.

**Research-leaning by default** (`.claude/rules/collaboration.md`, *Inform before parking*). A note that claims a gap is re-verified against the current tree before it scopes an entry — grep for the claimed-missing surface; a note stamped `observed at <sha>` narrows the check to `git log <sha>..HEAD`. Scope to the verified gap, never the reported one. A finding a chain could have decided routes to chain config or a boundary question, not an engine entry (`.claude/rules/engine-boundary.md`, *Routing rule*).

Route what routes cleanly. Leave the rest on disk rather than guess; the next inbox tick sees it again.

**Build's refusals are notes to plan too.** `<build-records>` carries every standing prior-attempt record and the last build wave's outcomes. A voluntary bail means a build agent looked and refused — "the work is already shipped" is the field-traced case; a park (`not-shipped`) means the entry cannot ship inside its fence, and its note under `.flume/plan/notes/` says why. Each is yours to resolve now: drop the entry, re-scope it, widen its `files`, or answer what it parked. A record whose tag is no longer in the queue is stale; say so in the commit body. An unreconciled record re-picks the same entry into the same wall.

Entry and artifact discipline: `.flume/prompts/plan-discipline.md` — read it before writing `pending.json` or `open-questions.md`.

# OUTPUT

One commit prefixed `plan:`; the body names each drained entry and where it went. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
