# A red lane's failing title got the report band by judgement, not by cite

`spec/harness.md`, *The phases* names four sources for a band: a downstream
report or an operator's ruling (`30`), a build note (`20`), a spec commit
(`10`), the sweep (`0`). The inbox slice drains a fifth thing that section
does not name — a failing title lifted out of a red CI lane — and its prompt
already routes that title "exactly as you route a record". I put it at `30`,
reading a lane's own report of a failing behavior as a downstream report. The
friction channel went with it for the same reason: it is what the loop had to
say to its owner, not a producer's note.

If that reading is wrong the fix is one clause in `FILING_BANDS["plan-inbox"]`
(`harness/prompts.ts`) and one clause-count in the inbox test; nothing else
keys on it. A ruling in the spec would move it up the ladder from my
judgement to a cite.

Second observation: the band is prose in a prompt, and nothing mechanical
holds a filed entry to it. The queue's schema takes any integer, so a slice
that files at the wrong band — or at none — reds no gate; the suite pins only
that each slice's prompt *names* its band. A pin that read a `plan:` commit's
new entries against the slice that wrote them would close that gap, but it
needs a fact the engine does not report today (which slice authored an entry
file), so it is not a shape build could reach from here. Filing it as an
observation rather than building it.
