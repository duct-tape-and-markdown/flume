# SPEC WINDOW

<spec-window>
!`node .flume/delta-window.mjs derive`
</spec-window>

<pending-now>
!`cat .flume/plan/pending.json`
</pending-now>

<state>
!`cat .flume/plan/state.md`
</state>

<open-questions-index>
!`grep -n '^## ' .flume/plan/open-questions.md || echo "(none open)"`
</open-questions-index>

# TASK

Derive the spec changes since `Spec derived through:` into pending entries. `spec/` is the source of truth: ratified intent changes there before it changes anywhere, and each changed or added section becomes the entries that make `src/` match it. Search the codebase before assuming a section unimplemented — a commit listed alongside may already have landed it, in which case the section is judged done in the commit body, not derived.

Each entry: `per` cites the section verbatim; `files` names the exact paths the work will touch, tests included; `blockedBy` when a prior entry must ship first; `acceptance` is one line that turns green; `tests[]` one line per behavior. Discrete, independently shippable units (`.flume/PROTOCOL.md`, *What makes an entry good*). A section that would need many large entries is a signal to file a spec-split open question, never to compress; the spec is sized for intent, not for plan's character budget. Open the questions file before parking: a "do not derive until X" note may already govern the section, and a question already open takes an amendment.

**The cursor.** `<spec-window>` renders spec commits oldest-first with their diffs, within a budget, and names the sha the cursor may advance to. Advance `Spec derived through:` to the last commit whose every changed section you derived into entries, judged done, or parked as a named question — never further, never as bookkeeping. A spec commit landing mid-tick is exactly the race this cursor exists to survive.

Discipline: `.flume/prompts/plan-discipline.md` — read it before writing `pending.json`.

# OUTPUT

One commit prefixed `plan:`; the body names each derived section and its entries, or why it needed none. Close per *Closing a slice* in the discipline file.

<schema>
{{PENDING_SCHEMA}}
</schema>
