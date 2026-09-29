# SPEC WINDOW

<spec-window>
{{SPEC_WINDOW}}
</spec-window>

{{PENDING_NOW}}

{{CLAIMED_ENTRIES}}

{{PLAN_STATE}}

{{PLAN_STATE_SHAPE}}

{{QUESTIONS_INDEX}}

{{ARTIFACTS}}

{{DOMAIN}}

# TASK

Derive the spec changes since `derivedThrough` into pending entries. The spec locus ({{SPEC_LOCUS}}) is the source of truth: ratified intent changes there before it changes anywhere, and each changed or added section becomes the entries that make the tree match it. Search the codebase before assuming a section unimplemented — a commit listed alongside may already have landed it, in which case the section is judged done in the commit body, not derived.

Each entry: `per` cites the section verbatim; `files` names the exact paths the work will touch, tests included; `blockedBy` when a prior entry must ship first; `acceptance` is one line that turns green; `tests[]` one line per behavior. Discrete, independently shippable units — `{{PROTOCOL}}` says what makes one good here. A section that would need many large entries is a signal to file a spec-split open question, never to compress; the spec is sized for intent, not for plan's character budget. Read the open questions before parking: a "do not derive until X" question may already govern the section, and one already open takes an amendment to its own file.

{{FILING_BAND}}

**The cursor.** `<spec-window>` renders spec commits oldest-first with their diffs, within a budget, and names the sha the cursor may advance to. Advance `derivedThrough` to the last commit whose every changed section you derived into entries, judged done, or parked as a named question — never further, never as bookkeeping. A spec commit landing mid-tick is exactly the race this cursor exists to survive.

Discipline: `{{DISCIPLINE}}` — read it before writing the queue.

{{PUT_DOWN}}

{{TURN_BOUNDARY}}

{{AUTONOMY}}

# OUTPUT

One commit prefixed `plan:`; the body names each derived section and its entries, or why it needed none. Close per *Closing a slice* in the discipline file.

{{PENDING_SCHEMA}}
